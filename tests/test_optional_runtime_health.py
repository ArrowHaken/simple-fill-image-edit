from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import builtins
import os
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.lama_backend import validate_installation


class OptionalRuntimeHealthTests(unittest.TestCase):
    def test_missing_torch_is_reported_without_raising(self):
        real_import = builtins.__import__

        def import_without_torch(name, *args, **kwargs):
            if name == "torch":
                raise ModuleNotFoundError("No module named 'torch'")
            return real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=import_without_torch):
            status = validate_installation()

        self.assertIsNone(status["torch"])
        self.assertFalse(status["cuda_available"])
        self.assertFalse(status["lama_ready"])
        self.assertIn("torch", status["torch_error"])

    def test_broken_torch_probe_is_reported_without_raising(self):
        class BrokenCuda:
            @staticmethod
            def is_available():
                raise OSError("CUDA runtime unavailable")

        class BrokenTorch:
            __version__ = "test"
            cuda = BrokenCuda()

        real_import = builtins.__import__

        def import_broken_torch(name, *args, **kwargs):
            if name == "torch":
                return BrokenTorch
            return real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=import_broken_torch):
            status = validate_installation()

        self.assertEqual(status["torch"], "test")
        self.assertFalse(status["lama_ready"])
        self.assertIn("CUDA runtime", status["torch_error"])

    def test_wavespeed_key_in_environment_is_ready(self):
        with patch.dict(os.environ, {"WAVESPEED_API_KEY": "configured"}):
            self.assertTrue(Settings().wavespeed_key_ready)

    def test_blank_wavespeed_key_file_is_not_ready(self):
        with TemporaryDirectory() as temp:
            path = Path(temp) / "wavespeed.key"
            path.write_text("  \n", encoding="utf-8")
            with patch.dict(os.environ, {"WAVESPEED_API_KEY": ""}):
                self.assertFalse(Settings(wavespeed_key_file=path).wavespeed_key_ready)


if __name__ == "__main__":
    unittest.main()
