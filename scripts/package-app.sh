#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${CONFIGURATION:-release}"
APP="$ROOT/dist/CodexAccountSwitcher.app"
BINARY="$ROOT/.build/$CONFIG/CodexAccountSwitcher"
RESOURCE_BUNDLE="$ROOT/.build/$CONFIG/CodexAccountSwitcher_CodexAccountSwitcher.bundle"

cd "$ROOT"
swift build -c "$CONFIG"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BINARY" "$APP/Contents/MacOS/CodexAccountSwitcher"
cp -R "$RESOURCE_BUNDLE" "$APP/CodexAccountSwitcher_CodexAccountSwitcher.bundle"
cp "$ROOT/Assets/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>CodexAccountSwitcher</string>
  <key>CFBundleIdentifier</key>
  <string>local.codex-account-switcher</string>
  <key>CFBundleName</key>
  <string>Codex Account Switcher</string>
  <key>CFBundleDisplayName</key>
  <string>Codex Account Switcher</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

echo "$APP"
