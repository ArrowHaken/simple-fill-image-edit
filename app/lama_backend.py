from __future__ import annotations

from pathlib import Path
import sys
import threading

import numpy as np

from .config import settings


_model = None
_lock = threading.Lock()


def _imports():
    upstream = str(settings.upstream_dir)
    if upstream not in sys.path:
        sys.path.insert(0, upstream)
    from lama_inpaint import build_lama_model, inpaint_img_with_builded_lama
    return build_lama_model, inpaint_img_with_builded_lama


def validate_installation() -> dict:
    """Return optional LaMa capabilities without blocking simple_fill.

    The semantic Image2 lane does not require PyTorch or the Big-LaMa
    checkpoint.  Health reporting must therefore remain useful in a lean
    environment instead of turning an otherwise runnable service into HTTP
    500 just because the optional cleanup lane is not installed.
    """
    try:
        import torch
        torch_version = getattr(torch, "__version__", None)
        cuda_available = bool(torch.cuda.is_available())
        cuda_device = torch.cuda.get_device_name(0) if cuda_available else None
    except Exception as exc:
        return {
            "torch": locals().get("torch_version"),
            "torch_error": str(exc),
            "cuda_available": False,
            "cuda_device": None,
            "checkpoint": str(settings.lama_checkpoint),
            "checkpoint_ready": False,
            "lama_ready": False,
        }
    return {
        "torch": torch_version,
        "cuda_available": cuda_available,
        "cuda_device": cuda_device,
        "checkpoint": str(settings.lama_checkpoint),
        "checkpoint_ready": (settings.lama_checkpoint / "models" / "best.ckpt").is_file(),
        "lama_ready": bool(
            torch.cuda.is_available()
            and (settings.lama_checkpoint / "models" / "best.ckpt").is_file()
        ),
    }


def get_model():
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is None:
            import torch
            if not torch.cuda.is_available():
                raise RuntimeError("完整 Big-LaMa 被配置为 GPU 模式，但当前 PyTorch 未检测到 CUDA")
            if not (settings.lama_checkpoint / "models" / "best.ckpt").is_file():
                raise RuntimeError(f"Big-LaMa 权重尚未就绪：{settings.lama_checkpoint}")
            build_lama_model, _ = _imports()
            _model = build_lama_model(
                str(settings.lama_config),
                str(settings.lama_checkpoint),
                device="cuda",
            )
    return _model


def inpaint(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    _, run = _imports()
    return run(
        get_model(), image, mask,
        config_p=str(settings.lama_config), device="cuda",
    )

