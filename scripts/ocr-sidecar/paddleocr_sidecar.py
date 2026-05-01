#!/usr/bin/env python3
import contextlib
import json
import os
import sys
import traceback
from pathlib import Path


def _prepend_path(path: Path) -> None:
    if not path.exists():
        return
    current = os.environ.get("PATH", "")
    prefix = str(path)
    if prefix not in current:
        os.environ["PATH"] = f"{prefix}{os.pathsep}{current}" if current else prefix
    if os.name == "nt":
        try:
            os.add_dll_directory(prefix)
        except (AttributeError, FileNotFoundError, OSError):
            # Older Python or restricted environments — PATH is still best-effort.
            pass


def configure_paddle_runtime_paths() -> None:
    """Ensure Paddle can load MKL / OpenMP DLLs on Windows frozen builds."""
    candidates: list[Path] = []

    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            meipass_path = Path(meipass).resolve()
            candidates.append(meipass_path)
            candidates.append(meipass_path / "paddle" / "libs")
            candidates.append(meipass_path / "_internal" / "paddle" / "libs")

        exe_dir = Path(sys.executable).resolve().parent
        candidates.append(exe_dir)
        candidates.append(exe_dir / "_internal")
        candidates.append(exe_dir / "_internal" / "paddle" / "libs")
        candidates.append(exe_dir / "paddle" / "libs")

    try:
        import importlib.util

        spec = importlib.util.find_spec("paddle")
        if spec and spec.origin:
            paddle_dir = Path(spec.origin).resolve().parent
            candidates.append(paddle_dir / "libs")
    except Exception:
        pass

    for path in candidates:
        _prepend_path(path)


def configure_offline_home():
    # In the frozen sidecar, keep PaddleX model lookup inside resources/ocr.
    # The prepared installer ships resources/ocr/.paddlex/official_models.
    if getattr(sys, "frozen", False):
        sidecar_home = str(Path(sys.executable).resolve().parent)
        os.environ["HOME"] = sidecar_home
        os.environ["USERPROFILE"] = sidecar_home
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")


def collect_texts(value):
    texts = []
    if value is None:
        return texts
    if isinstance(value, dict):
        for key in ("rec_texts", "texts"):
            found = value.get(key)
            if isinstance(found, (list, tuple)):
                return [str(item).strip() for item in found if str(item).strip()]
        for key in ("text", "transcription"):
            found = value.get(key)
            if isinstance(found, str) and found.strip():
                return [found.strip()]
        for child in value.values():
            texts.extend(collect_texts(child))
        return texts
    if isinstance(value, (list, tuple)):
        if len(value) >= 2 and isinstance(value[1], (list, tuple)) and value[1]:
            maybe_text = value[1][0]
            if isinstance(maybe_text, str) and maybe_text.strip():
                texts.append(maybe_text.strip())
        for child in value:
            texts.extend(collect_texts(child))
    return texts


def main() -> int:
    configure_offline_home()
    configure_paddle_runtime_paths()

    if len(sys.argv) < 2:
        print("usage: paddleocr-sidecar <image-or-pdf-path>", file=sys.stderr)
        return 2

    target = Path(sys.argv[1])
    if not target.exists():
        print(f"file not found: {target}", file=sys.stderr)
        return 2

    try:
        with contextlib.redirect_stdout(sys.stderr):
            try:
                from paddleocr import PaddleOCR
            except Exception as exc:
                print(f"PaddleOCR import failed: {exc}", file=sys.stderr)
                return 3

            try:
                ocr = PaddleOCR(use_textline_orientation=True, lang="ch")
            except TypeError:
                ocr = PaddleOCR(use_angle_cls=True, lang="ch")

            if hasattr(ocr, "predict"):
                result = ocr.predict(str(target))
            else:
                result = ocr.ocr(str(target), cls=True)

        seen = set()
        ordered = []
        for text in collect_texts(result):
            if text and text not in seen:
                seen.add(text)
                ordered.append(text)

        print(json.dumps({"text": "\n".join(ordered)}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"PaddleOCR failed: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
