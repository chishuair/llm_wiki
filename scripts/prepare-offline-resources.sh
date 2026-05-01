#!/usr/bin/env bash
# Prepare resources required for an offline installer build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LAWBASE_SRC="$REPO_ROOT/lawbase-pack-full"
LAWBASE_DEST="$REPO_ROOT/resources/lawbase"
OCR_DEST="$REPO_ROOT/resources/ocr"

mkdir -p "$LAWBASE_DEST" "$OCR_DEST" "$REPO_ROOT/resources/pdfium" "$REPO_ROOT/resources/docs"

if [[ ! -f "$LAWBASE_SRC/lawbase-pack.json" ]]; then
  echo "[offline-resources] ERROR: missing $LAWBASE_SRC/lawbase-pack.json" >&2
  exit 1
fi

cp "$LAWBASE_SRC/lawbase-pack.json" "$LAWBASE_DEST/lawbase-pack.json"
if [[ -f "$LAWBASE_SRC/manifest.json" ]]; then
  cp "$LAWBASE_SRC/manifest.json" "$LAWBASE_DEST/manifest.json"
fi

PDFIUM_READY=""
case "$(uname -s)" in
  Darwin) [[ -f "$REPO_ROOT/resources/pdfium/libpdfium.dylib" ]] && PDFIUM_READY=1 ;;
  Linux) [[ -f "$REPO_ROOT/resources/pdfium/libpdfium.so" ]] && PDFIUM_READY=1 ;;
  MINGW*|MSYS*|CYGWIN*) [[ -f "$REPO_ROOT/resources/pdfium/pdfium.dll" ]] && PDFIUM_READY=1 ;;
esac

if [[ -z "$PDFIUM_READY" ]]; then
  "$SCRIPT_DIR/fetch-pdfium.sh"
fi

OCR_BIN=""
case "$(uname -s)" in
  Darwin|Linux)
    for name in paddleocr-sidecar paddleocr ocr; do
      if [[ -x "$OCR_DEST/$name" ]]; then OCR_BIN="$OCR_DEST/$name"; break; fi
    done
    ;;
  MINGW*|MSYS*|CYGWIN*)
    for name in paddleocr-sidecar.exe paddleocr.exe ocr.exe; do
      if [[ -x "$OCR_DEST/$name" || -f "$OCR_DEST/$name" ]]; then OCR_BIN="$OCR_DEST/$name"; break; fi
    done
    ;;
esac

if [[ -z "$OCR_BIN" ]]; then
  echo "[offline-resources] ERROR: missing bundled PaddleOCR sidecar in $OCR_DEST" >&2
  echo "[offline-resources] Build one with: scripts/build-paddleocr-sidecar.sh" >&2
  exit 1
fi

echo "[offline-resources] lawbase ready: $LAWBASE_DEST/lawbase-pack.json"
echo "[offline-resources] pdfium ready: $REPO_ROOT/resources/pdfium"
echo "[offline-resources] ocr sidecar ready: $OCR_BIN"
