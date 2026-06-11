# JS Helper Refactor Design

## Summary

Refactor the JavaScript helper side of Codex Account Switcher with tests first. The goal is to keep current behavior stable while making the CDP launcher, bridge server, runtime account service, and injected renderer script easier to test and change.

## Goals

- Split the large JS test file into focused test files by responsibility.
- Add behavior tests before moving production code.
- Extract narrow modules from `cdp.js`, `bridge-server.js`, and `account-service.js` only after tests cover the existing behavior.
- Preserve the current user-facing behavior:
  - No mutation of `/Applications/Codex.app`.
  - Launch Codex with a CDP port.
  - Inject account UI through CDP.
  - Switch accounts by writing `~/.codex/auth.json` and relaunching Codex.
  - Pick a free debug port when the preferred port is occupied by a non-Codex process.

## Non-Goals

- Do not redesign the SwiftUI UI.
- Do not reintroduce asar patching.
- Do not attempt hot account switching without relaunch.
- Do not change the account snapshot file format.
- Do not rewrite `renderer-inject.js` into a framework or build step.

## Current Shape

- `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp.js` mixes CDP HTTP queries, target selection, WebSocket session handling, process detection, Codex launch, bridge daemon startup, and status shaping.
- `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge-server.js` mixes HTTP routing, launch lifecycle, bridge state, account service wiring, and Codex browser session cleanup.
- `Sources/CodexAccountSwitcher/Resources/runtime/account-service.js` mixes account file operations, auth parsing, login URL rewriting, external URL opening, asar header parsing, and bridge command dispatch.
- `Sources/CodexAccountSwitcher/Resources/cdp-helper/renderer-inject.js` is a single injected runtime containing i18n, bridge calls, native login integration, account popup UI, Settings page UI, DOM observers, and cleanup.
- `test/helper.test.js` currently covers many behaviors but is broad, order-sensitive to read, and still relies on source-string assertions for most renderer behavior.

## Target Test Layout

Create focused Node test files under `test/`:

- `test/account-service.test.js`
  - save, switch, delete, autosave, duplicate email selection, active-auth clearing
  - login URL rewriting
  - JSON error payload behavior
- `test/asar-assets.test.js`
  - asar header traversal
  - current and legacy asset roots
  - invalid prefix and invalid header errors
- `test/cdp-targets.test.js`
  - target filtering
  - main renderer preference
  - overlay exclusion
  - missing target errors
- `test/cdp-launch.test.js`
  - debug args
  - occupied port skipping
  - non-Codex listener skipping
  - process detection
  - no forced new app instance
- `test/bridge-server.test.js`
  - bridge status payloads
  - JSON error forwarding
  - browser login state cleanup
  - launch lifecycle state when debug port changes
- `test/renderer-source.test.js`
  - source-level guardrails for the injected script
  - no Electron preload APIs
  - cleanup before reinjection
  - reliable relaunch switching
  - native login URL order

The initial refactor may keep source-string tests for `renderer-inject.js`. DOM-level renderer tests are outside this design unless a lightweight DOM test harness is added in a separate approved scope.

## Target Module Boundaries

The refactor should split files into small CommonJS modules without changing runtime packaging.

### CDP Helper

- `lib/cdp/http.js`
  - `fetchJSON`
  - `listTargets`
  - `isDebugPortReady`
  - `cdpStatus`
- `lib/cdp/targets.js`
  - `targetWebSocket`
  - `codexPageTargets`
  - `pickCodexTarget`
- `lib/cdp/session.js`
  - `CdpSession`
  - bridge binding response handling
- `lib/cdp/inject.js`
  - `rendererInjectionSource`
  - `injectTarget`
  - `injectRenderer`
  - `injectRenderers`
- `lib/cdp/processes.js`
  - Codex process detection
  - `quitCodex`
  - `waitForCodexExit`
  - termination fallback
- `lib/cdp/launcher.js`
  - debug args
  - launch args
  - launch Codex
  - choose debug port
  - ensure Codex launched
- `lib/cdp/bridge-client.js`
  - `queryBridge`
  - `waitForBridge`
  - `startBridgeDaemon`
- `lib/cdp/status.js`
  - `makeStatusPayload`
  - Codex version reading

Keep `lib/cdp.js` as a compatibility barrel that exports the same public functions existing callers and tests use.

### Bridge Server

- `lib/bridge/state.js`
  - active CDP sessions
  - injected timestamp
  - last error
  - launching flag
- `lib/bridge/browser-session.js`
  - Codex browser session paths
  - browser login state cleanup
- `lib/bridge/http-server.js`
  - request routing and JSON response helpers

Keep `lib/bridge-server.js` as the public entrypoint exporting `serveBridge`, `clearCodexBrowserLoginState`, `codexBrowserSessionPaths`, and `cdpTargetNotReadyMessage`.

### Runtime Account Service

- `runtime/account-paths.js`
  - `codexAuthPaths`
  - account path helpers
  - path existence
- `runtime/auth-store.js`
  - read state
  - save, switch, delete, clear active auth
  - autosave and duplicate email selection
- `runtime/auth-email.js`
  - email extraction and JWT payload parsing
- `runtime/login-url.js`
  - account chooser URL rewrite and URL validation
- `runtime/asar-assets.js`
  - asar header parsing and asset lookup

Keep `runtime/account-service.js` as a command dispatcher and compatibility entrypoint.

## Error Handling

- All CLI and bridge command failures must remain machine-readable JSON.
- Port collision recovery must log the old and new debug ports.
- Account commands must continue returning `{ ok: false, error: { message } }` instead of throwing across the bridge boundary.
- Renderer menu actions must continue showing async errors instead of silently failing.

## Migration Plan

1. Split `test/helper.test.js` into focused test files without production changes.
2. Add missing tests for invalid asar headers, invalid asset prefixes, account usage cache filtering, clear-active backup creation, bridge status when debug port changes, and renderer reliable relaunch guardrails.
3. Extract `runtime/*` account modules behind the existing `account-service.js` export surface.
4. Extract CDP modules behind the existing `lib/cdp.js` export surface.
5. Extract bridge modules behind the existing `lib/bridge-server.js` export surface.
6. Run full verification after each extraction and commit in small batches.

## Acceptance Criteria

- `npm test` passes with the split test files.
- `npm run check` passes and includes every new JS file.
- `swift test` passes.
- `swift build` passes.
- Public JS exports used by Swift helper commands and existing tests remain compatible.
- Existing command-line behavior remains unchanged:
  - `--install` maps to launch.
  - `--repair` maps to inject.
  - `--uninstall` maps to stop.
  - `--status-json` reports bridge and CDP status.
