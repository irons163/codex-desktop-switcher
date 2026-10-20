#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-release}"
TARGET_ARCH="${TARGET_ARCH:-$(uname -m)}"
CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:--}"
APP_PATH="$PROJECT_ROOT/dist/CodexAccountSwitcher.app"
STAGING_PATH="$PROJECT_ROOT/dist/.CodexAccountSwitcher.app.staging"

case "$CONFIGURATION" in
  debug|release) ;;
  *) echo "CONFIGURATION must be debug or release." >&2; exit 1 ;;
esac
case "$TARGET_ARCH" in
  arm64|x86_64) ;;
  *) echo "TARGET_ARCH must be arm64 or x86_64." >&2; exit 1 ;;
esac

cd "$PROJECT_ROOT"
swift build -c "$CONFIGURATION" --arch "$TARGET_ARCH" --product CodexAccountSwitcher
BIN_DIR="$(swift build -c "$CONFIGURATION" --arch "$TARGET_ARCH" --show-bin-path)"
RESOURCE_BUNDLE="$BIN_DIR/CodexAccountSwitcher_CodexAccountSwitcher.bundle"

rm -rf "$STAGING_PATH"
mkdir -p "$STAGING_PATH/Contents/MacOS" "$STAGING_PATH/Contents/Resources"
cp "$BIN_DIR/CodexAccountSwitcher" "$STAGING_PATH/Contents/MacOS/CodexAccountSwitcher"
ditto "$RESOURCE_BUNDLE" "$STAGING_PATH/Contents/Resources/$(basename "$RESOURCE_BUNDLE")"
cp "$PROJECT_ROOT/Assets/AppIcon.icns" "$STAGING_PATH/Contents/Resources/AppIcon.icns"
cp "$PROJECT_ROOT/Packaging/Info.plist" "$STAGING_PATH/Contents/Info.plist"

SIGN_ARGS=(--force --sign "$CODE_SIGN_IDENTITY")
if [[ "$CODE_SIGN_IDENTITY" != "-" ]]; then
  SIGN_ARGS+=(--timestamp --options runtime)
fi
codesign "${SIGN_ARGS[@]}" "$STAGING_PATH"
codesign --verify --deep --strict --verbose=2 "$STAGING_PATH"

rm -rf "$APP_PATH"
mv "$STAGING_PATH" "$APP_PATH"
echo "$APP_PATH"
