# Codex Account Switcher

Native macOS SwiftUI manager for launching Codex with an in-app account switcher.

Download the signed, Apple-notarized Apple Silicon or Intel installer from
[GitHub Releases](https://github.com/irons163/codex-desktop-switcher/releases/latest).
Requires macOS 13 or later and an installed Codex or compatible ChatGPT desktop
app. Install Node.js 22 or later if the desktop app does not bundle Node.js.

Account snapshots contain local authentication credentials. See
[SECURITY.md](SECURITY.md) for the trust boundary and
[the pre-publication security review](docs/security-review-2026-10-20.md) for the
checks performed before this repository became public.

## Screenshots

Screenshots use placeholder accounts (`@example.com`) for demo purposes.

### Launcher

![Codex Account Switcher launcher](docs/screenshots/launcher-mockup.png)

### In-Codex settings

![Accounts settings page injected into Codex](docs/screenshots/codex-accounts-mockup.png)

### Profile menu

![Account switcher menu in the Codex profile dropdown](docs/screenshots/codex-menu-mockup.png)

This version does **not** modify `/Applications/Codex.app`. It starts Codex with a
local Chromium DevTools Protocol port, keeps a small local bridge process alive,
and injects the account UI into the Codex renderer at runtime.

The bridge stores logs and runtime state in:

```text
~/Library/Application Support/codex-account-switcher/
```

Saved Codex account snapshots use the Codex++ account-switcher-compatible
layout:

```text
~/.codex/auth.json
~/.codex/auth_accounts/<name>.json
~/.codex/current_account
~/.codex/auth_accounts_usage.json
```

## Build And Test

```sh
npm install
swift test
swift build
npm test
npm run check
.build/debug/CodexAccountSwitcher --status-json
```

Node tests are grouped by account runtime, asar assets, CDP targets and launch,
bridge behavior, renderer source guardrails, and public export compatibility.
Run one suite directly with `node --test test/<suite>.test.js`.

To produce a double-clickable app bundle:

```sh
scripts/package-app.sh
open dist/CodexAccountSwitcher.app
```

Local packages use an ad-hoc signature. Set `TARGET_ARCH=arm64` or
`TARGET_ARCH=x86_64` to select an architecture and run `scripts/verify-app.sh`
to check the bundle, signature, and helper CLI. Set `CODE_SIGN_IDENTITY` to a
Developer ID Application identity for a distribution signature.

## Releases

GitHub Actions follows the same native Apple Silicon / Intel build and
Developer ID notarization flow as `codex-theme-switcher`. CI runs the Swift and
Node tests, syntax checks, and packaged-app verification on both architectures.
The release workflow uploads two signed, notarized DMGs, matching dSYM archives,
and `SHA256SUMS` only after both builds succeed. It retries transient Apple
ticket-delivery failures while keeping notarization and Gatekeeper checks
mandatory.

Configure these secrets in the repository's `release-production` environment:

```text
APPLE_CERTIFICATE_P12_BASE64
APPLE_CERTIFICATE_PASSWORD
KEYCHAIN_PASSWORD
APPLE_TEAM_ID
APPLE_API_KEY_ID
APPLE_API_ISSUER_ID
APPLE_API_PRIVATE_KEY_BASE64
```

Before releasing, update `CFBundleShortVersionString` and `CFBundleVersion` in
`Packaging/Info.plist`, keep `package.json` and `package-lock.json` versions in
sync, and add `docs/release-notes/v<VERSION>.md`. Commit and push those changes
to `main`.

Create a draft release at that commit, then dispatch the release workflow:

```sh
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 --verify-tag --draft \
  --title 'Codex Account Switcher 0.1.0' \
  --notes-file docs/release-notes/v0.1.0.md
gh workflow run release.yml --ref main -f release_tag=v0.1.0
```

The workflow publishes the draft after uploading all verified assets. Publishing
a release directly also triggers the workflow. To retry an existing release,
dispatch `release.yml` with its `release_tag`; the workflow rebuilds the exact
tagged commit and replaces the matching assets.

## Commands

```sh
.build/debug/CodexAccountSwitcher --status-json
.build/debug/CodexAccountSwitcher --launch
.build/debug/CodexAccountSwitcher --inject
.build/debug/CodexAccountSwitcher --stop
```

Compatibility aliases are still accepted:

```sh
.build/debug/CodexAccountSwitcher --install
.build/debug/CodexAccountSwitcher --repair --quiet
.build/debug/CodexAccountSwitcher --uninstall
```

Those aliases now map to launch, inject, and stop. They do not mutate Codex.app,
do not update asar integrity metadata, and do not re-sign the Codex bundle.
