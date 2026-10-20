# Codex Account Switcher

[繁體中文](README.md) | **English**

A native macOS app for saving and switching Codex accounts from the desktop
app's profile menu and Accounts settings page. Built with SwiftUI.

## Download

**Current release: [v0.1.1](https://github.com/irons163/codex-desktop-switcher/releases/tag/v0.1.1)**

| Your Mac | Installer |
| --- | --- |
| Apple Silicon (M-series) | [Apple Silicon DMG](https://github.com/irons163/codex-desktop-switcher/releases/download/v0.1.1/CodexAccountSwitcher-0.1.1-apple-silicon.dmg) |
| Intel | [Intel DMG](https://github.com/irons163/codex-desktop-switcher/releases/download/v0.1.1/CodexAccountSwitcher-0.1.1-intel.dmg) |

Both installers are signed with Developer ID and notarized by Apple. The
[release page](https://github.com/irons163/codex-desktop-switcher/releases/latest)
also includes `SHA256SUMS` and optional `.dSYM.zip` debugging symbols.

### Requirements

- macOS 13 or later.
- An installed Codex desktop app or compatible unified ChatGPT desktop app.
- Node.js 22 or later if the desktop app does not bundle Node.js.

## Install and use

1. Download the DMG for your Mac, open it, and drag **Codex Account Switcher**
   into **Applications**.
2. Open the switcher and click **Launch**. Codex may restart to enable the
   account interface; launch can take up to 60 seconds.
3. In Codex, open the profile menu or **Settings → Accounts**. Use
   **Save current account** to name and save the current login.
4. Use **New sign-in** to add another account. The current login is saved before
   the new sign-in flow starts.
5. Choose a saved account to switch. Codex restarts to apply that account.

Keep launching Codex through the switcher when you want the account interface.
If it is missing, click **Launch** again and use **Refresh** to check the
injection and bridge status. **Advanced → Reveal Logs** opens the log folder.

## Features

- Save multiple accounts and switch from the Codex profile menu or settings.
- Apply account changes through a full Codex restart.
- Follow the system language or choose among 65 interface locales, including
  English and Traditional Chinese.
- Support both Codex and compatible unified ChatGPT desktop installations.
- Add the account interface at runtime through a local Chromium DevTools
  Protocol (CDP) connection, without modifying or re-signing the installed app.

## Screenshots

These are illustrative mockups using placeholder accounts (`@example.com`).
The surrounding Codex interface may vary by desktop app version.

### Launcher

![Codex Account Switcher launcher](docs/screenshots/launcher-mockup.png)

### Accounts settings

![Accounts settings page inside Codex](docs/screenshots/codex-accounts-mockup.png)

### Profile menu

![Account switcher in the Codex profile menu](docs/screenshots/codex-menu-mockup.png)

## Security and local data

Account snapshots and backups contain plaintext authentication credentials.
The switcher uses owner-only permissions for its credential directories and
files; keep your macOS account and backups protected.

The bridge listens on localhost and rejects cross-site control requests.
The CDP debug connection grants powerful access to the running app, so local
processes remain within the trust boundary. To end the debugging session, stop
the bridge and quit Codex.

| Location | Contents |
| --- | --- |
| `~/.codex/auth.json` | Active Codex authentication |
| `~/.codex/auth_accounts/<name>.json` | Saved account snapshots |
| `~/.codex/current_account` | Current account name |
| `~/.codex/auth_accounts_usage.json` | Account usage cache |
| `~/.codex/auth.account-switcher-backup-*.json` | Authentication backups created when clearing the active login |
| `~/Library/Application Support/codex-account-switcher/` | Bridge logs, preferences, and runtime state |

The account layout is compatible with the Codex++ account switcher. See
[SECURITY.md](SECURITY.md) and the
[pre-publication security review](docs/security-review-2026-10-20.md) for details.
Report vulnerabilities through
[private vulnerability reporting](https://github.com/irons163/codex-desktop-switcher/security/advisories/new).

## Build and test

Development requires a Swift 6 toolchain with the macOS SDK and Node.js 22 or later.

```sh
git clone https://github.com/irons163/codex-desktop-switcher.git
cd codex-desktop-switcher
npm ci
swift test
npm test
npm run check
swift build
.build/debug/CodexAccountSwitcher --status-json
```

Build and verify a local app bundle:

```sh
scripts/package-app.sh
scripts/verify-app.sh
open dist/CodexAccountSwitcher.app
```

Local packages use an ad-hoc signature. Set `TARGET_ARCH=arm64` or
`TARGET_ARCH=x86_64` to choose an architecture. Set `CODE_SIGN_IDENTITY` to a
Developer ID Application identity for a distribution signature. Verification
executes the app, so run `scripts/verify-app.sh` on the matching architecture.

Run a single Node test suite with `node --test test/<suite>.test.js`.
CI tests and verifies packaged apps on native Apple Silicon and Intel runners,
and scans the complete Git history for secrets.

### Command line

Use `.build/debug/CodexAccountSwitcher` with these options:

| Option | Action |
| --- | --- |
| `--status-json` | Report app, bridge, and injection status as JSON |
| `--launch` | Launch Codex and inject the account interface |
| `--inject` | Attach to an existing Codex debugging session and inject the interface |
| `--stop` | Stop the switcher bridge |

Compatibility aliases remain available: `--install` maps to `--launch`,
`--repair --quiet` maps to `--inject --quiet`, and `--uninstall` maps to `--stop`.
