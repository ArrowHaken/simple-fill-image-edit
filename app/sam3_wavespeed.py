from __future__ import annotations

from pathlib import Path
from typing import Any
import json
import mimetypes
import time

import numpy as np
import requests
from pycocotools import mask as mask_utils

from .config import settings


class WaveSpeedError(RuntimeError):
    pass


_PROMPT_ALIASES = {
    "头发": "hair", "人物": "person", "人": "person", "脸": "face", "脸部": "face",
    "眼镜": "glasses", "帽子": "hat", "上衣": "shirt", "衣服": "clothing",
    "裤子": "pants", "裙子": "skirt", "鞋子": "shoes", "背景": "background",
    "文字": "text", "标志": "logo", "logo": "logo", "花": "flower", "书": "book",
    "杯子": "cup", "瓶子": "bottle", "食物": "food", "猫": "cat", "狗": "dog",
    "汽车": "car", "天空": "sky",
    "手": "hand", "手掌": "hand", "右手": "right hand", "左手": "left hand",
    "手臂": "arm", "右手臂": "right arm", "左手臂": "left arm",
    "前臂": "forearm", "袖子": "sleeve", "袖口": "cuff", "飘带": "ribbon",
    "白猫": "white cat", "长毛猫": "long-haired cat",
}

# A project may ask SAM3 for the same source more than once (for example, a
# target followed by a protected foreground object).  WaveSpeed accepts the
# uploaded media URL, so reuse a recent ticket instead of uploading identical
# bytes again.  The short TTL avoids depending on an indefinitely valid URL.
_UPLOAD_CACHE: dict[tuple[str, int, int], tuple[str, float]] = {}
_UPLOAD_CACHE_TTL = 300.0


def _provider_prompt(value: str) -> str:
    clean = value.strip()
    return _PROMPT_ALIASES.get(clean.casefold(), clean)


def _api_key() -> str:
    env = __import__("os").environ.get("WAVESPEED_API_KEY", "").strip()
    if env:
        return env
    if not settings.wavespeed_key_file.is_file():
        raise WaveSpeedError("未找到 WaveSpeed API Key 文件")
    key = settings.wavespeed_key_file.read_text(encoding="utf-8").strip()
    if not key:
        raise WaveSpeedError("WaveSpeed API Key 文件为空")
    return key


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_api_key()}"}


def upload_image(path: Path) -> str:
    stat = path.stat()
    cache_key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
    now = time.monotonic()
    cached = _UPLOAD_CACHE.get(cache_key)
    if cached and now - cached[1] < _UPLOAD_CACHE_TTL:
        return cached[0]
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    response = requests.post(
        f"{settings.wavespeed_base}/media/uploads",
        headers={**_headers(), "Content-Type": "application/json"},
        json={"filename": path.name, "size": path.stat().st_size, "content_type": mime},
        timeout=(10, 60),
    )
    response.raise_for_status()
    body = response.json()
    if body.get("code") != 200:
        raise WaveSpeedError(body.get("message") or "创建上传票据失败")
    ticket = body["data"]
    upload = ticket["upload"]
    with path.open("rb") as stream:
        pushed = requests.request(
            upload.get("method", "PUT"),
            upload["url"],
            headers=upload.get("headers", {}),
            data=stream,
            timeout=(10, 300),
        )
    pushed.raise_for_status()
    download_url = ticket["download_url"]
    _UPLOAD_CACHE[cache_key] = (download_url, now)
    # Bound memory if a long-lived worker sees many one-off uploads.
    for key, (_, created) in list(_UPLOAD_CACHE.items()):
        if now - created >= _UPLOAD_CACHE_TTL:
            _UPLOAD_CACHE.pop(key, None)
    return download_url


def _unwrap(body: dict[str, Any]) -> dict[str, Any]:
    return body.get("data", body)


def _collect_rles(value: Any, size: tuple[int, int]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        if "counts" in value or "rle" in value:
            uses_wavespeed_pairs = "rle" in value and "counts" not in value
            counts = value.get("counts", value.get("rle"))
            rle_size = value.get("size") or [size[1], size[0]]
            found.append({
                "counts": counts, "size": rle_size,
                "format": "wavespeed_pairs" if uses_wavespeed_pairs else "coco",
            })
        for child in value.values():
            found.extend(_collect_rles(child, size))
    elif isinstance(value, list):
        for child in value:
            found.extend(_collect_rles(child, size))
    return found


def _resolve_outputs(outputs: Any) -> Any:
    if isinstance(outputs, str):
        stripped = outputs.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            return json.loads(stripped)
        if stripped.startswith("http://") or stripped.startswith("https://"):
            response = requests.get(stripped, timeout=(10, 60))
            response.raise_for_status()
            try:
                return response.json()
            except requests.JSONDecodeError:
                return response.text
    if isinstance(outputs, list):
        return [_resolve_outputs(item) for item in outputs]
    return outputs


def _decode_rle(item: dict[str, Any]) -> np.ndarray:
    counts = item["counts"]
    if counts is None or counts == [] or (isinstance(counts, str) and not counts.strip()):
        raise WaveSpeedError("SAM3 返回了空蒙版；请调整点选位置或改用文字选择后重试")
    if isinstance(counts, str) and counts.strip() and all(
        token.isdigit() for token in counts.split()
    ):
        counts = [int(token) for token in counts.split()]
    rle = {"size": [int(v) for v in item["size"]], "counts": counts}
    if item.get("format") == "wavespeed_pairs" and isinstance(counts, list):
        if len(counts) % 2:
            raise WaveSpeedError("Invalid WaveSpeed start-length RLE")
        height, width = rle["size"]
        flat = np.zeros(height * width, dtype=np.uint8)
        for start, length in zip(counts[0::2], counts[1::2]):
            begin = max(0, int(start) - 1)
            end = min(flat.size, begin + int(length))
            if begin < end:
                flat[begin:end] = 1
        return flat.reshape((height, width), order="F")
    if isinstance(rle["counts"], list):
        # WaveSpeed documents a space-separated, uncompressed COCO RLE.  The
        # C extension's decode function accepts only compressed counts, so
        # normalize this representation through the official COCO helper.
        try:
            rle = mask_utils.frPyObjects(rle, rle["size"][0], rle["size"][1])
        except Exception:
            # The live endpoint currently emits the documented sample shape
            # ``start length start length ...`` (absolute, 1-based starts),
            # which is not COCO's cumulative run-count representation despite
            # the documentation calling it COCO-compatible.
            values = rle["counts"]
            if len(values) % 2:
                raise WaveSpeedError("Invalid RLE mask representation")
            height, width = rle["size"]
            flat = np.zeros(height * width, dtype=np.uint8)
            for start, length in zip(values[0::2], values[1::2]):
                begin = max(0, int(start) - 1)
                end = min(flat.size, begin + int(length))
                if begin < end:
                    flat[begin:end] = 1
            return flat.reshape((height, width), order="F")
    elif isinstance(rle["counts"], str):
        rle["counts"] = rle["counts"].encode("ascii")
    decoded = mask_utils.decode(rle)
    if decoded.ndim == 3:
        decoded = np.any(decoded, axis=2)
    return (decoded > 0).astype(np.uint8)


def _choose_mask(masks: list[np.ndarray], points: list[dict[str, int]]) -> np.ndarray:
    if not masks:
        raise WaveSpeedError("SAM3 已完成但没有返回可解码蒙版")
    if len(masks) == 1:
        return masks[0]
    best = None
    best_score = float("-inf")
    for mask in masks:
        h, w = mask.shape
        score = 0.0
        for point in points:
            x = min(max(int(point["x"]), 0), w - 1)
            y = min(max(int(point["y"]), 0), h - 1)
            inside = bool(mask[y, x])
            score += 10 if inside == bool(point.get("label", 1)) else -10
        coverage = float(mask.mean())
        score -= coverage * 0.25
        if score > best_score:
            best, best_score = mask, score
    return best


def segment(image_path: Path, *, points: list[dict[str, int]],
            prompt: str = "", boxes: list[dict[str, int]] | None = None,
            timeout_seconds: int = 240) -> tuple[np.ndarray, dict[str, Any]]:
    from PIL import Image

    with Image.open(image_path) as image:
        width, height = image.size
    started = time.monotonic()
    download_url = upload_image(image_path)
    uploaded_at = time.monotonic()
    payload: dict[str, Any] = {
        "image": download_url,
        "point_prompts": points,
        "box_prompts": boxes or [],
        "apply_mask": False,
        "enable_sync_mode": False,
    }
    # WaveSpeed's live SAM3 route can return an empty mask when text, positive
    # points and negative points are mixed.  Match Inpaint Anything's two
    # distinct interaction modes: points/boxes take priority; text is the
    # alternative when no spatial prompt exists.
    prompt_sent = ""
    if prompt.strip() and not points and not boxes:
        prompt_sent = _provider_prompt(prompt)[:32]
        payload["prompt"] = prompt_sent
    submitted_at = time.monotonic()
    response = requests.post(
        f"{settings.wavespeed_base}/wavespeed-ai/sam3-image-rle",
        headers={**_headers(), "Content-Type": "application/json"},
        json=payload,
        timeout=(10, 60),
    )
    if not response.ok:
        detail = response.text.strip().replace("\n", " ")[:800]
        raise WaveSpeedError(
            f"SAM3 提交失败 HTTP {response.status_code}: {detail or response.reason}"
        )
    task = _unwrap(response.json())
    prediction_id = task.get("id")
    if not prediction_id:
        raise WaveSpeedError("SAM3 提交响应没有 prediction id")
    result_url = task.get("urls", {}).get("get") or (
        f"{settings.wavespeed_base}/predictions/{prediction_id}/result"
    )
    submitted_done_at = time.monotonic()
    deadline = submitted_done_at + timeout_seconds
    poll_count = 0
    while True:
        status = task.get("status")
        if status == "completed":
            break
        if status in {"failed", "cancelled", "timeout"}:
            raise WaveSpeedError(task.get("error") or f"SAM3 任务状态：{status}")
        if time.monotonic() >= deadline:
            raise WaveSpeedError(f"SAM3 轮询超时；prediction_id={prediction_id}")
        # Poll more responsively than the old 1.5 s cadence; the provider's
        # queue dominates total latency, while this removes up to 0.7 s after
        # inference completes.
        time.sleep(0.8)
        poll_count += 1
        polled = requests.get(result_url, headers=_headers(), timeout=(10, 60))
        polled.raise_for_status()
        task = _unwrap(polled.json())

    outputs = _resolve_outputs(task.get("outputs", []))
    debug_path = settings.data_dir / "sam3-last-output.json"
    try:
        debug_path.write_text(json.dumps(outputs, ensure_ascii=False, indent=2), encoding="utf-8")
    except (OSError, TypeError):
        pass
    rles = _collect_rles(outputs, (width, height))
    masks = [_decode_rle(item) for item in rles]
    mask = _choose_mask(masks, points)
    if mask.shape != (height, width):
        import cv2
        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)
    provider_record = {
        "provider": "wavespeed",
        "model": "wavespeed-ai/sam3-image-rle",
        "prediction_id": prediction_id,
        "status": task.get("status"),
        "timings": {
            **task.get("timings", {}),
            "upload_ms": round((uploaded_at - started) * 1000),
            "submit_ms": round((submitted_done_at - uploaded_at) * 1000),
            "wait_ms": round((time.monotonic() - submitted_done_at) * 1000),
            "poll_count": poll_count,
        },
        "mask_candidates": len(masks),
        "input_mode": "spatial" if points or boxes else "text",
        "prompt_sent": prompt_sent or None,
    }
    return (mask * 255).astype(np.uint8), provider_record
