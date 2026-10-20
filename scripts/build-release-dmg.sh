#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ARCH="${TARGET_ARCH:-$(uname -m)}"
CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:--}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
APP_PATH="$PROJECT_ROOT/dist/CodexAccountSwitcher.app"
INFO_PLIST="$PROJECT_ROOT/Packaging/Info.plist"
WORK_DIR="$PROJECT_ROOT/build/release-$TARGET_ARCH"

case "$TARGET_ARCH" in
  arm64) ARCH_LABEL=apple-silicon ;;
  x86_64) ARCH_LABEL=intel ;;
  *) echo "TARGET_ARCH must be arm64 or x86_64." >&2; exit 1 ;;
esac
if [[ "$CODE_SIGN_IDENTITY" == "-" || -z "$NOTARY_PROFILE" ]]; then
  echo "Developer ID signing and NOTARY_PROFILE are required for notarization." >&2
  exit 1
fi
[[ "$(uname -m)" == "$TARGET_ARCH" ]] || {
  echo "Release installers must be built and verified on a native ${TARGET_ARCH} runner." >&2
  exit 1
}
RELEASE_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST")"

cd "$PROJECT_ROOT"
export TARGET_ARCH CODE_SIGN_IDENTITY
scripts/package-app.sh
scripts/verify-app.sh
SIGNATURE_DETAILS="$(codesign -d --verbose=4 "$APP_PATH" 2>&1)"
for required in 'Authority=Developer ID Application' 'Timestamp=' 'Runtime Version='; do
  grep -Fq "$required" <<< "$SIGNATURE_DETAILS" || {
    echo "Distribution signature is missing: ${required}" >&2
    exit 1
  }
done

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/dmg-staging"
APP_BINARY="$APP_PATH/Contents/MacOS/CodexAccountSwitcher"
DSYM_PATH="$WORK_DIR/CodexAccountSwitcher.app.dSYM"
ASSET_PREFIX="CodexAccountSwitcher-${RELEASE_VERSION}-${ARCH_LABEL}"
dsymutil "$APP_BINARY" -o "$DSYM_PATH"
APP_UUIDS="$(dwarfdump --uuid "$APP_BINARY" | awk '{print $2}' | sort -u)"
DSYM_UUIDS="$(dwarfdump --uuid "$DSYM_PATH" | awk '{print $2}' | sort -u)"
[[ -n "$APP_UUIDS" && "$APP_UUIDS" == "$DSYM_UUIDS" ]] || {
  echo "Release symbols do not match the executable." >&2
  exit 1
}
ditto -c -k --sequesterRsrc --keepParent "$DSYM_PATH" "$WORK_DIR/${ASSET_PREFIX}.dSYM.zip"
ditto "$APP_PATH" "$WORK_DIR/dmg-staging/CodexAccountSwitcher.app"
ln -s /Applications "$WORK_DIR/dmg-staging/Applications"
DMG_PATH="$WORK_DIR/${ASSET_PREFIX}.dmg"
hdiutil create -volname 'Codex Account Switcher' \
  -srcfolder "$WORK_DIR/dmg-staging" -ov -format UDZO "$DMG_PATH"

retry_stapler() {
  local attempt status
  for attempt in 1 2 3 4 5; do
    if xcrun stapler "$@"; then return 0; else status=$?; fi
    if [[ "$status" -ne 68 || "$attempt" -eq 5 ]]; then return "$status"; fi
    echo "Apple ticket delivery failed; retrying ${1} (attempt $((attempt + 1))/5)." >&2
    sleep "$((attempt * 5))"
  done
}

codesign --force --timestamp --sign "$CODE_SIGN_IDENTITY" "$DMG_PATH"
codesign --verify --strict --verbose=2 "$DMG_PATH"
xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" \
  --wait --output-format json | tee "$WORK_DIR/notary-result.json"
python3 - "$WORK_DIR/notary-result.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    result = json.load(handle)
if result.get("status") != "Accepted":
    raise SystemExit(f"Notarization failed: {result.get('status', 'unknown')}")
PY
retry_stapler staple "$DMG_PATH"
retry_stapler validate "$DMG_PATH"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH"
hdiutil verify "$DMG_PATH"
cp "$DMG_PATH" "$WORK_DIR/${ASSET_PREFIX}.dSYM.zip" "$PROJECT_ROOT/dist/"
echo "Release artifacts: dist/${ASSET_PREFIX}.dmg and dist/${ASSET_PREFIX}.dSYM.zip"
