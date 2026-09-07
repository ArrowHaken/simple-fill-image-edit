"""Workbench contracts: previews, drafts, capabilities and safe task submission."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field

from . import storage
from .config import settings
from .compositor import build_simple_fill_mask, expand_mask, read_mask

router = APIRouter()


def mark_interrupted_tasks():
    for project in storage.list_projects():
        for task_id in project.get("tasks", []):
            try:
                task = storage.read_task(project["id"], task_id)
                if task["status"] in {"created", "generating"}:
                    storage.update_task(project["id"], task_id, status="interrupted", stage="本地服务重启，任务执行已中断",
                        error="请检查是否已有生成图片。服务重启不会自动重新提交生成。")
            except (OSError, json.JSONDecodeError):
                continue


def capabilities():
    direct = settings.masked_image2_key_ready
    ssh = settings.ssh_key.is_file() and (settings.root / "scripts/catsco-masked-image2.mjs").is_file()
    return {
        "manual_selection": True,
        "semantic_selection": settings.wavespeed_key_ready,
        "generation": direct or ssh,
        "generation_reason": "" if direct or ssh else "图片生成服务尚未配置，仍可上传图片、框选和保存草稿。",
        "semantic_reason": "" if settings.wavespeed_key_ready else "智能选区尚未配置，请使用手动框选。",
        "generation_route": "direct" if direct else "ssh" if ssh else "unavailable",
        "prompt_limit": 32,
    }


router.add_api_route("/api/capabilities", capabilities, methods=["GET"])


def simple_plan(mask, values):
    from .main import _is_removal_prompt
    editable, record = build_simple_fill_mask(mask, cleanup_radius_px=values.get("dilation", 6), growth_ratio=values.get("growth_ratio", .35))
    removal = _is_removal_prompt(values.get("prompt", ""))
    if removal:
        radius = min(values.get("cleanup_radius", 10), record["growth_radius_px"])
        commit = np.where((expand_mask(mask, radius) > 0) & (editable > 0), 255, 0).astype(np.uint8)
    else:
        commit = editable.copy()
    feather = min(32, max(values.get("feather", 3), 16, int(record["growth_radius_px"] * .45)))
    return {"editable": editable, "commit": commit, "record": record, "feather": feather}


def preview_fingerprint(values):
    payload = {key: value for key, value in values.items() if key not in {"request_id", "preview_id"}}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:24]


def mask_outlines(mask):
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    # Keep holes and disconnected regions. Coordinates stay in source-image pixels.
    return [contour.reshape(-1, 2).tolist() for contour in contours if len(contour) >= 2]


def create_preview(project_id, request):
    from .main import _mask_record, _resolve_source
    project = storage.read_project(project_id)
    record = _mask_record(project, request.mask_id)
    source_ref = record.get("source_ref", "source")
    if request.source_ref and request.source_ref != source_ref:
        raise HTTPException(409, "选区不属于当前版本，请重新选择。")
    source = _resolve_source(project, source_ref)
    with Image.open(source) as image:
        size = image.size
    mask = read_mask(storage.project_dir(project_id) / "masks" / f"{request.mask_id}.png", size)
    values = request.model_dump()
    plan = simple_plan(mask, values)
    pid = preview_fingerprint(values)
    folder = storage.project_dir(project_id) / "previews"
    folder.mkdir(exist_ok=True)
    # Transparent overlay: green is the selected target, amber the actual commit boundary.
    overlay = np.zeros((*mask.shape, 4), dtype=np.uint8)
    overlay[plan["commit"] > 0] = (186, 121, 23, 38)
    overlay[mask > 0] = (8, 125, 101, 62)
    thickness = max(2, round(max(size) / 700))
    kernel = np.ones((thickness * 2 + 1, thickness * 2 + 1), np.uint8)
    target_edge = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, kernel)
    commit_edge = cv2.morphologyEx(plan["commit"], cv2.MORPH_GRADIENT, kernel)
    overlay[target_edge > 0] = (8, 125, 101, 230)
    overlay[commit_edge > 0] = (171, 103, 11, 240)
    Image.fromarray(overlay).save(folder / f"{pid}.png")
    Image.fromarray(plan["commit"]).save(folder / f"{pid}-commit.png")
    return {"id": pid, "overlay_url": f"/media/projects/{project_id}/previews/{pid}.png",
            "outlines": {"target": mask_outlines(mask), "boundary": mask_outlines(plan["commit"])},
            "target_coverage": float((mask > 0).mean()), "coverage": float((plan["commit"] > 0).mean()),
            "growth_radius": plan["record"]["growth_radius_px"], "feather": plan["feather"],
            "source_ref": source_ref}


def save_draft(project_id, request):
    from .main import _mask_record, _resolve_source
    with storage.transaction():
        project = storage.read_project(project_id)
        _resolve_source(project, request.source_ref)
        for mid in ([request.target_mask_id] if request.target_mask_id else []) + request.protected_mask_ids:
            if _mask_record(project, mid).get("source_ref", "source") != request.source_ref:
                raise HTTPException(409, "选区不属于当前底图，请重新选择。")
        drafts = project.setdefault("edit_drafts", {})
        previous = drafts.get(request.source_ref, {})
        if request.expected_revision is not None and previous.get("revision", 0) != request.expected_revision:
            raise HTTPException(409, "此草稿已在其他窗口更新，请重新打开项目后继续。")
        value = request.model_dump(exclude={"expected_revision"})
        value["revision"] = previous.get("revision", 0) + 1
        drafts[request.source_ref] = value
        project["edit_draft"] = value
        project["active_source_ref"] = request.source_ref
        # Clearing a selection must also clear the legacy remembered mask.
        project["active_mask_id"] = request.target_mask_id
        storage.write_project(project)
        return value


def submit(project_id, request):
    from .main import _mask_record, executor, _run_task
    values = request.model_dump()
    signature = preview_fingerprint(values)
    with storage.transaction():
        project = storage.read_project(project_id)
        key = request.request_id or uuid4().hex
        previous = project.get("submissions", {}).get(key)
        if previous:
            if previous["signature"] != signature:
                raise HTTPException(409, "提交标识已用于其他修改，请重新提交。")
            return public_task(storage.read_task(project_id, previous["task_id"]))
        mask = _mask_record(project, request.mask_id)
        if request.source_ref and mask.get("source_ref", "source") != request.source_ref:
            raise HTTPException(409, "选区已过期，请重新选择。")
        if request.operation != "remove" and not request.prompt.strip():
            raise HTTPException(400, "请填写修改要求。")
        if request.pipeline_mode == "simple_fill" and request.protected_mask_ids:
            raise HTTPException(400, "当前编辑方式不支持保护图层，请清除保护设置。")
        for mid in request.protected_mask_ids:
            if _mask_record(project, mid).get("source_ref", "source") != mask.get("source_ref", "source"):
                raise HTTPException(409, "保护选区和修改目标必须来自同一版本。")
        if request.preview_id:
            if request.preview_id != signature or not (storage.project_dir(project_id) / "previews" / f"{signature}-commit.png").is_file():
                raise HTTPException(409, "修改范围已变化，请等待预览更新后再生成。")
        if request.operation == "remove":
            from .lama_backend import validate_installation
            if not validate_installation().get("lama_ready"):
                raise HTTPException(503, "本机图像移除服务尚未配置。")
        elif not capabilities()["generation"]:
            raise HTTPException(503, capabilities()["generation_reason"])
        task = storage.create_task(project_id, request.operation, request.prompt.strip(), request.mask_id,
            request.dilation, request.feather, request.protected_mask_ids, request.result_object_prompt,
            request.pipeline_mode, request.cleanup_radius, request.semantic_edge, request.growth_ratio)
        task = storage.update_task(project_id, task["id"], request_id=key, preview_id=request.preview_id,
            provider_route=capabilities()["generation_route"], source_ref=mask.get("source_ref", "source"))
        storage.update_project(project_id, lambda p: p.setdefault("submissions", {}).__setitem__(key, {"signature": signature, "task_id": task["id"]}))
        executor.submit(_run_task, project_id, task["id"])
        return public_task(task)


def cached_provider(task):
    folder = storage.project_dir(task["project_id"]) / "tasks" / task["id"]
    candidates = [task.get("artifacts", {}).get("provider_original"), "image2-native-mask-provider-original.png", "image2-provider-original.png"]
    for name in candidates:
        if not name or Path(name).name != name:
            continue
        path = folder / name
        try:
            with Image.open(path) as image:
                image.verify()
            return path
        except (OSError, ValueError):
            pass
    return None


def public_task(task):
    return {**task, "can_resume": task.get("status") in {"failed", "interrupted"} and task.get("operation") == "fill" and cached_provider(task) is not None}


def resume_cached(project_id, task_id):
    from .main import executor, _run_task, _resolve_source
    with storage.transaction():
        project = storage.read_project(project_id)
        task = storage.read_task(project_id, task_id)
        _resolve_source(project, task.get("source_ref", "source"))
        if task["status"] not in {"failed", "interrupted"}:
            raise HTTPException(409, "任务仍在运行或已经完成。")
        if task.get("operation") != "fill" or cached_provider(task) is None:
            raise HTTPException(409, "没有可继续处理的本地图片。请先确认原服务任务状态；此操作不会重新提交生成。")
        task = storage.update_task(project_id, task_id, status="created", stage="继续处理已生成图片", progress=10, error=None, resume_only=True)
        executor.submit(_run_task, project_id, task_id)
        return public_task(task)


class RenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


def require_idle(project):
    for task_id in project.get("tasks", []):
        task = storage.read_task(project["id"], task_id)
        if task.get("status") not in {"completed", "failed", "interrupted", "cancelled"}:
            raise HTTPException(409, "素材还有运行中的任务，请等待任务结束后再删除。")


@router.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    try:
        with storage.transaction():
            project = storage.read_project(project_id)
            require_idle(project)
            # Retain local files, while removing the project from all workbench reads.
            project["deleted_at"] = storage.now_iso()
            storage.write_project(project)
        return {"deleted": True, "id": project_id}
    except FileNotFoundError:
        raise HTTPException(404, "素材不存在或已删除。")


@router.delete("/api/projects/{project_id}/versions/{version_id}")
def delete_version(project_id: str, version_id: str):
    if version_id == "source":
        raise HTTPException(400, "原始素材不能单独删除，请使用删除素材。")
    try:
        with storage.transaction():
            project = storage.read_project(project_id)
            require_idle(project)
            version = next((v for v in project.get("versions", []) if v["id"] == version_id), None)
            if version is None:
                raise HTTPException(404, "版本不存在或已删除。")
            # Preserve the image for comparisons of later versions derived from it.
            project.setdefault("deleted_versions", []).append({**version, "deleted_at": storage.now_iso()})
            storage.write_project(project)
        return storage.public_project(project)
    except FileNotFoundError:
        raise HTTPException(404, "素材不存在或已删除。")


@router.patch("/api/projects/{project_id}")
def rename_project(project_id: str, request: RenameRequest):
    if not request.name.strip():
        raise HTTPException(400, "项目名称不能为空。")
    try:
        project = storage.update_project(project_id, lambda p: p.update(name=request.name.strip()))
        return {"id": project_id, "name": project["name"]}
    except FileNotFoundError:
        raise HTTPException(404, "项目不存在。")


@router.get("/api/projects/{project_id}/original/download")
def download_original(project_id: str):
    try:
        project = storage.read_project(project_id)
    except FileNotFoundError:
        raise HTTPException(404, "项目不存在。")
    path = storage.project_dir(project_id) / project.get("original_file", "source.png")
    return FileResponse(path, filename=project.get("source_name") or "original.png")
