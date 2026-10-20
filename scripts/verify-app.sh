#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${APP_PATH:-$PROJECT_ROOT/dist/CodexAccountSwitcher.app}"
TARGET_ARCH="${TARGET_ARCH:-$(uname -m)}"
APP_BINARY="$APP_PATH/Contents/MacOS/CodexAccountSwitcher"
RESOURCE_ROOT="$APP_PATH/Contents/Resources/CodexAccountSwitcher_CodexAccountSwitcher.bundle/Resources"

[[ "$(lipo -archs "$APP_BINARY")" == "$TARGET_ARCH" ]] || {
  echo "Packaged executable does not match ${TARGET_ARCH}." >&2
  exit 1
}
plutil -lint "$APP_PATH/Contents/Info.plist"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
for relative in cdp-helper/cli.js runtime/account-service.js runtime/auth-identity.js runtime/codex-login.js locales/messages.json; do
  [[ -s "$RESOURCE_ROOT/$relative" ]] || {
    echo "Missing packaged resource: $relative" >&2
    exit 1
  }
done

# Run from outside the checkout to verify the installed app finds its helper.
# A missing target app exercises the CLI without reading or changing accounts.
SMOKE_DIR="$(mktemp -d)"
trap 'rm -rf "$SMOKE_DIR"' EXIT
cd "$SMOKE_DIR"
set +e
"$APP_BINARY" --status-json --codex-app "$SMOKE_DIR/Missing.app" > response.json
SMOKE_STATUS=$?
set -e
[[ "$SMOKE_STATUS" == 1 ]]
node -e '
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const response = JSON.parse(fs.readFileSync("response.json", "utf8"));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "missing-codex-app");
'
echo "Packaged ${TARGET_ARCH} app passed signature, resource, and CLI checks."
