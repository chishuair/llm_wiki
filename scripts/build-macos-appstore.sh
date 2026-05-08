#!/usr/bin/env bash
# Build a Mac App Store upload package for Transporter.
#
# Required local assets:
# - Apple Distribution certificate in Keychain
# - 3rd Party Mac Developer Installer certificate in Keychain
# - Mac App Store provisioning profile for com.caseknowledge.desktop
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_NAME="${APP_NAME:-案件知识库}"
APP_ID="${APP_ID:-com.caseknowledge.desktop}"
TEAM_ID="${APPLE_TEAM_ID:-N9577KZ27M}"
VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"

INSTALLER_CERT="${INSTALLER_CERT:-3rd Party Mac Developer Installer: Qingdao Silicon-Based Eternal AI Co., Ltd. (N9577KZ27M)}"
PROFILE="${APPSTORE_PROVISIONING_PROFILE:-/Users/chishuai/Desktop/证书/AI_Case_Wiki_Mac_App_Store.provisionprofile}"
ENTITLEMENTS="$REPO_ROOT/src-tauri/Entitlements.appstore.plist"

APP_PATH="$REPO_ROOT/src-tauri/target/release/bundle/macos/$APP_NAME.app"
OUT_DIR="$REPO_ROOT/src-tauri/target/release/bundle/appstore"
PKG_PATH="$OUT_DIR/${APP_NAME}_${VERSION}_appstore.pkg"

die() {
  echo "[mac-appstore] ERROR: $*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || die "missing file: $1"
}

require_file "$PROFILE"
require_file "$ENTITLEMENTS"
require_file "$REPO_ROOT/resources/lawbase/lawbase-pack.json"
require_file "$REPO_ROOT/resources/ocr/paddleocr-sidecar"
require_file "$REPO_ROOT/resources/pdfium/libpdfium.dylib"

decoded_profile="$(mktemp)"
trap 'rm -f "$decoded_profile"' EXIT
security cms -D -i "$PROFILE" > "$decoded_profile" 2>/dev/null
profile_app_id="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$decoded_profile" 2>/dev/null || true)"
if [[ -z "$profile_app_id" ]]; then
  profile_app_id="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.application-identifier' "$decoded_profile")"
fi
profile_cert_sha1="$(python3 - "$decoded_profile" <<'PY'
import pathlib
import plistlib
import subprocess
import sys
import tempfile

data = plistlib.loads(pathlib.Path(sys.argv[1]).read_bytes())
certs = data.get("DeveloperCertificates") or []
if not certs:
    raise SystemExit("profile has no DeveloperCertificates")
with tempfile.NamedTemporaryFile(delete=False) as f:
    f.write(certs[0])
    cert_path = f.name
try:
    output = subprocess.check_output(
        ["openssl", "x509", "-inform", "DER", "-in", cert_path, "-noout", "-fingerprint", "-sha1"],
        text=True,
    )
finally:
    pathlib.Path(cert_path).unlink(missing_ok=True)
print(output.split("=", 1)[1].strip().replace(":", ""))
PY
)"
expected_app_id="$TEAM_ID.$APP_ID"
if [[ "$profile_app_id" != "$expected_app_id" ]]; then
  die "provisioning profile app id mismatch: got '$profile_app_id', expected '$expected_app_id'"
fi

echo "[mac-appstore] checking certificates"
echo "[mac-appstore] profile requires Apple Distribution SHA-1: $profile_cert_sha1"
security find-identity -v -p codesigning | grep -F "$profile_cert_sha1" >/dev/null \
  || die "Apple Distribution identity from provisioning profile is not available locally: $profile_cert_sha1"
APP_CERT="${APP_CERT:-$profile_cert_sha1}"
security find-certificate -c "$INSTALLER_CERT" -a -Z >/dev/null \
  || die "Installer certificate not found: $INSTALLER_CERT"

echo "[mac-appstore] building .app with Tauri"
(
  cd "$REPO_ROOT"
  env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_SIGNING_IDENTITY \
    npm run tauri build -- --bundles app
)

[[ -d "$APP_PATH" ]] || die "Tauri app bundle not found: $APP_PATH"

echo "[mac-appstore] embedding provisioning profile"
cp "$PROFILE" "$APP_PATH/Contents/embedded.provisionprofile"

sign_macho() {
  local file="$1"
  local file_info
  file_info="$(file "$file")"
  [[ "$file_info" == *"Mach-O"* ]] || return 0

  if [[ "$file_info" == *"dynamically linked shared library"* || "$file" == *.dylib ]]; then
    echo "[mac-appstore] signing dylib: $file"
    codesign --force --sign "$APP_CERT" --options runtime "$file"
  else
    echo "[mac-appstore] signing executable: $file"
    codesign --force --sign "$APP_CERT" --options runtime --entitlements "$ENTITLEMENTS" "$file"
  fi
}

echo "[mac-appstore] signing nested binaries"
while IFS= read -r -d '' file_path; do
  sign_macho "$file_path"
done < <(find "$APP_PATH/Contents" -type f -print0)

echo "[mac-appstore] signing app bundle"
codesign --force --sign "$APP_CERT" --options runtime --entitlements "$ENTITLEMENTS" "$APP_PATH"

echo "[mac-appstore] verifying app signature"
codesign --verify --deep --strict --verbose=4 "$APP_PATH"

mkdir -p "$OUT_DIR"
rm -f "$PKG_PATH"

echo "[mac-appstore] building signed pkg"
productbuild \
  --component "$APP_PATH" /Applications \
  --sign "$INSTALLER_CERT" \
  "$PKG_PATH"

echo "[mac-appstore] verifying pkg"
pkgutil --check-signature "$PKG_PATH"

echo "[mac-appstore] done: $PKG_PATH"
