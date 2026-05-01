#!/usr/bin/env bash
# Build a bundled PaddleOCR sidecar executable into resources/ocr/.
# This is a build-time helper; end users do not need Python.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$SCRIPT_DIR/ocr-sidecar/paddleocr_sidecar.py"
DEST="$REPO_ROOT/resources/ocr"
WORK="$REPO_ROOT/.offline-build/paddleocr-sidecar"

mkdir -p "$DEST" "$WORK"

PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! "$PYTHON_BIN" - <<'PY'
import importlib.util
import sys
missing = [name for name in ("paddleocr", "paddle", "PyInstaller") if importlib.util.find_spec(name) is None]
if missing:
    print("missing build dependencies: " + ", ".join(missing), file=sys.stderr)
    sys.exit(1)
PY
then
  echo "[ocr-sidecar] ERROR: build dependencies are missing in $PYTHON_BIN" >&2
  echo "[ocr-sidecar] Install them in a build environment, for example:" >&2
  echo "  $PYTHON_BIN -m pip install paddlepaddle paddleocr pyinstaller" >&2
  exit 1
fi

"$PYTHON_BIN" -m PyInstaller \
  --clean \
  --onefile \
  --name paddleocr-sidecar \
  --collect-all paddleocr \
  --collect-all paddlex \
  --copy-metadata paddleocr \
  --copy-metadata paddlepaddle \
  --copy-metadata paddlex \
  --copy-metadata imagesize \
  --copy-metadata opencv-contrib-python \
  --copy-metadata pyclipper \
  --copy-metadata pypdfium2 \
  --copy-metadata python-bidi \
  --copy-metadata shapely \
  --distpath "$DEST" \
  --workpath "$WORK/work" \
  --specpath "$WORK/spec" \
  "$SRC"

if [[ ! -x "$DEST/paddleocr-sidecar" && ! -f "$DEST/paddleocr-sidecar.exe" ]]; then
  echo "[ocr-sidecar] ERROR: PyInstaller did not produce the expected sidecar" >&2
  exit 1
fi

echo "[ocr-sidecar] built into $DEST"
