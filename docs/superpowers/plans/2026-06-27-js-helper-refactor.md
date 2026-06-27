# JS Helper Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a focused JavaScript test safety net, then split the account runtime, CDP helper, and bridge server into narrow CommonJS modules without changing public behavior.

**Architecture:** Preserve `runtime/account-service.js`, `cdp-helper/lib/cdp.js`, and `cdp-helper/lib/bridge-server.js` as compatibility entrypoints. Move cohesive functions behind those entrypoints in small commits, with public export contracts and behavior tests guarding every extraction.

**Tech Stack:** Node.js CommonJS, `node:test`, macOS process/launch APIs, Chromium DevTools Protocol, SwiftPM verification.

---

## File Map

**Test support and suites**

- Create `test/support/fixtures.js`: temporary HOME, auth JSON, asar fixture, and local HTTP server helpers.
- Create `test/public-exports.test.js`: compatibility contracts for the three public JS entrypoints.
- Create `test/account-service.test.js`: account command and login URL behavior.
- Create `test/asar-assets.test.js`: asar parsing and asset lookup behavior.
- Create `test/cdp-targets.test.js`: renderer target selection behavior.
- Create `test/cdp-launch.test.js`: process, port, launch, CLI, and bridge-client behavior.
- Create `test/bridge-server.test.js`: bridge readiness and browser-session behavior.
- Create `test/renderer-source.test.js`: injected renderer source guardrails.
- Delete `test/helper.test.js` after every test has moved.

**Runtime account modules**

- Create `Sources/CodexAccountSwitcher/Resources/runtime/account-paths.js`.
- Create `Sources/CodexAccountSwitcher/Resources/runtime/auth-email.js`.
- Create `Sources/CodexAccountSwitcher/Resources/runtime/login-url.js`.
- Create `Sources/CodexAccountSwitcher/Resources/runtime/asar-assets.js`.
- Create `Sources/CodexAccountSwitcher/Resources/runtime/auth-store.js`.
- Modify `Sources/CodexAccountSwitcher/Resources/runtime/account-service.js` into a command dispatcher and compatibility barrel.

**CDP modules**

- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/http.js`.
- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/targets.js`.
- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/session.js`.
- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/inject.js`.
- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/processes.js`.
- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/launcher.js`.
- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/bridge-client.js`.
- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/status.js`.
- Modify `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp.js` into a compatibility barrel.

**Bridge modules**

- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge/state.js`.
- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge/browser-session.js`.
- Create `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge/http-server.js`.
- Modify `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge-server.js` to orchestrate those modules.

### Task 1: Add Shared Test Fixtures And Public Export Contracts

**Files:**
- Create: `test/support/fixtures.js`
- Create: `test/public-exports.test.js`

- [ ] **Step 1: Create reusable fixture helpers**

Create `test/support/fixtures.js` with this complete API:

```js
"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function auth(email, profile = email) {
  return JSON.stringify({
    auth_mode: "chatgpt",
    profile_id: profile,
    email,
    tokens: { access_token: "access", refresh_token: "refresh" },
  });
}

async function withTempHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-switcher-helper-"));
  try {
    return await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function writeAsarHeaderFixture(asarPath, header) {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(json.length + 9, 4);
  prefix.writeUInt32LE(json.length + 5, 8);
  prefix.writeUInt32LE(json.length, 12);
  await fs.writeFile(asarPath, Buffer.concat([prefix, json]));
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

module.exports = { auth, close, listen, withTempHome, writeAsarHeaderFixture };
```

- [ ] **Step 2: Add public export contract tests**

Create `test/public-exports.test.js`:

```js
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const accountService = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");
const cdp = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp");
const bridge = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge-server");

test("account service keeps its public exports", () => {
  assert.deepEqual(Object.keys(accountService).sort(), [
    "accountChooserURL",
    "codexAuthPaths",
    "collectAsarFiles",
    "createAccountService",
    "emailFromAuthString",
    "findCodexAssetByPrefix",
    "normalizeAccountName",
    "openAccountChooserURL",
  ].sort());
});

test("CDP helper keeps its public exports", () => {
  assert.deepEqual(Object.keys(cdp).sort(), [
    "DEFAULT_DEBUG_PORT", "cdpStatus", "chooseDebugPortForLaunch",
    "codexDebugArgs", "codexLaunchArgs", "codexMainProcessIds",
    "codexPageTargets", "codexProcessListHasMainCommand", "ensureCodexApp",
    "ensureCodexLaunched", "findAvailablePort", "injectRenderer",
    "injectRenderers", "isCodexMainProcessCommand", "isCodexRunning",
    "isDebugPortReady", "launchCodex", "listTargets", "makeStatusPayload",
    "pickCodexTarget", "portIsAvailable", "queryBridge", "quitCodex",
    "readCodexVersion", "rendererInjectionSource", "sleep",
    "startBridgeDaemon", "waitForBridge",
  ].sort());
});

test("bridge server keeps its public exports", () => {
  assert.deepEqual(Object.keys(bridge).sort(), [
    "cdpTargetNotReadyMessage",
    "clearCodexBrowserLoginState",
    "codexBrowserSessionPaths",
    "serveBridge",
  ].sort());
});
```

- [ ] **Step 3: Run the contract tests**

Run: `node --test test/public-exports.test.js`

Expected: 3 tests pass. These are characterization tests for the existing public surface.

- [ ] **Step 4: Commit the test contracts**

```bash
git add test/support/fixtures.js test/public-exports.test.js
git commit -m "test: lock JS helper export contracts"
```

### Task 2: Split The Monolithic Node Test Suite

**Files:**
- Create: `test/account-service.test.js`
- Create: `test/asar-assets.test.js`
- Create: `test/cdp-targets.test.js`
- Create: `test/cdp-launch.test.js`
- Create: `test/bridge-server.test.js`
- Create: `test/renderer-source.test.js`
- Delete: `test/helper.test.js`

- [ ] **Step 1: Move account tests verbatim**

Create `test/account-service.test.js` with the account-service imports plus `auth` and `withTempHome` from `./support/fixtures`. Move these exact tests without changing their assertions:

```text
account service saves, switches, deletes, and reports state
account service switch requests a real Codex restart by default
account service starts a new login by preserving the active account first
account login URL forces fresh auth without unsupported prompt values
account service opens Codex login URLs in fresh auth mode
account chooser opener rejects non-http login URLs
helper status emits JSON error for missing Codex app
```

Use this import block:

```js
"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { auth, withTempHome } = require("./support/fixtures");
const {
  accountChooserURL,
  createAccountService,
  openAccountChooserURL,
} = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");
```

- [ ] **Step 2: Move asar tests verbatim**

Create `test/asar-assets.test.js`, import `withTempHome` and `writeAsarHeaderFixture`, and move `account service finds Codex lazy asset chunks from the app asar header` unchanged.

```js
"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { withTempHome, writeAsarHeaderFixture } = require("./support/fixtures");
const {
  createAccountService,
  findCodexAssetByPrefix,
} = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");
```

- [ ] **Step 3: Move CDP target tests verbatim**

Create `test/cdp-targets.test.js` and move the three target-selection tests unchanged:

```text
CDP target picker prefers Codex renderer pages
CDP target picker prefers the main Codex page over avatar overlay
CDP injection includes every Codex app page target
```

```js
"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  codexPageTargets,
  pickCodexTarget,
} = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp");
```

- [ ] **Step 4: Move CDP launch tests verbatim**

Create `test/cdp-launch.test.js` and move these exact tests unchanged:

```text
CDP launcher args enable local browser debugging without app patching
CDP debug port selection skips occupied ports
CDP launch port selection skips non-Codex listeners
bridge query preserves JSON error messages from failed bridge requests
CLI launch path checks whether the default debug port already hosts Codex
Codex process detector recognizes macOS app executable commands
Codex process detector returns every main process id
Codex launcher does not force a new application instance
CDP injection refreshes the renderer binding and allows runtime eval under CSP
```

Use the current `cdp.js` imports and import `close` and `listen` from `./support/fixtures` for local servers.

- [ ] **Step 5: Move bridge and renderer tests verbatim**

Create `test/bridge-server.test.js` containing:

```text
bridge explains when reinject cannot attach to a debug target
bridge clears Codex browser login state for fresh account login
```

Create `test/renderer-source.test.js` containing every test from `renderer injection uses CDP binding bridge instead of Electron preload APIs` through `renderer asset discovery supports current and legacy Codex asset roots`, excluding the CDP source assertion moved in Step 4.

- [ ] **Step 6: Delete the old test file and run the full suite**

Delete `test/helper.test.js` only after every test name appears once under `test/*.test.js`.

Run: `npm test`

Expected: 35 tests pass, 0 fail. The original 32 behavior tests and 3 export-contract tests must each appear exactly once.

- [ ] **Step 7: Commit the mechanical test split**

```bash
git add test
git commit -m "test: split JS helper suites by responsibility"
```

### Task 3: Add Missing Account And Asar Characterization Tests

**Files:**
- Modify: `test/account-service.test.js`
- Modify: `test/asar-assets.test.js`

- [ ] **Step 1: Add account usage cache and clear-active tests**

Append to `test/account-service.test.js`:

```js
test("account state only reports usage for visible saved accounts", async () => {
  await withTempHome(async (home) => {
    const service = createAccountService({ home });
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "auth.json"), auth("work@example.com", "work"));
    await fs.writeFile(path.join(accountsDir, "work.json"), auth("work@example.com", "work"));
    await fs.writeFile(path.join(codexDir, "auth_accounts_usage.json"), JSON.stringify({
      work: { remaining: 42 },
      deleted: { remaining: 99 },
    }));

    const result = await service.handle({ action: "state" });

    assert.deepEqual(result.state.accountUsage, { work: { remaining: 42 } });
  });
});

test("clear-active backs up auth before removing the active marker", async () => {
  await withTempHome(async (home) => {
    const service = createAccountService({ home });
    const codexDir = path.join(home, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "auth.json"), auth("work@example.com", "work"));
    await fs.writeFile(path.join(codexDir, "current_account"), "work\n");

    const result = await service.handle({ action: "clear-active", relaunch: false });
    const files = await fs.readdir(codexDir);

    assert.equal(result.ok, true);
    assert.equal(result.state.hasActiveAuth, false);
    assert.equal(files.some((name) => name.startsWith("auth.account-switcher-backup-")), true);
    await assert.rejects(() => fs.access(path.join(codexDir, "auth.json")));
    await assert.rejects(() => fs.access(path.join(codexDir, "current_account")));
  });
});
```

- [ ] **Step 2: Run the account characterization tests**

Run: `node --test test/account-service.test.js`

Expected: all tests pass against current production code. A failure means the fixture or documented behavior is wrong and must be resolved before extraction.

- [ ] **Step 3: Add invalid asar input tests**

Append to `test/asar-assets.test.js`:

```js
test("asar asset lookup rejects unsafe prefixes", async () => {
  await assert.rejects(
    () => findCodexAssetByPrefix("/Applications/Codex.app", "../secret"),
    /Asset prefix is required/,
  );
});

test("asar asset lookup reports an invalid header size", async () => {
  await withTempHome(async (home) => {
    const codexApp = path.join(home, "Codex.app");
    const asarPath = path.join(codexApp, "Contents", "Resources", "app.asar");
    await fs.mkdir(path.dirname(asarPath), { recursive: true });
    await fs.writeFile(asarPath, Buffer.alloc(16));

    await assert.rejects(
      () => findCodexAssetByPrefix(codexApp, "index-"),
      /Invalid asar header size/,
    );
  });
});
```

- [ ] **Step 4: Run all Node tests and commit**

Run: `npm test`

Expected: 39 tests pass, 0 fail.

```bash
git add test/account-service.test.js test/asar-assets.test.js
git commit -m "test: cover account cache and asar failures"
```

### Task 4: Extract Runtime Account Modules

**Files:**
- Create: `Sources/CodexAccountSwitcher/Resources/runtime/account-paths.js`
- Create: `Sources/CodexAccountSwitcher/Resources/runtime/auth-email.js`
- Create: `Sources/CodexAccountSwitcher/Resources/runtime/login-url.js`
- Create: `Sources/CodexAccountSwitcher/Resources/runtime/asar-assets.js`
- Create: `Sources/CodexAccountSwitcher/Resources/runtime/auth-store.js`
- Modify: `Sources/CodexAccountSwitcher/Resources/runtime/account-service.js`
- Test: `test/account-service.test.js`
- Test: `test/asar-assets.test.js`
- Test: `test/public-exports.test.js`

- [ ] **Step 1: Add direct module contract tests and verify RED**

Add imports to the two focused test files:

```js
const { emailFromAuthString: directEmailFromAuthString } = require("../Sources/CodexAccountSwitcher/Resources/runtime/auth-email");
const { accountChooserURL: directAccountChooserURL } = require("../Sources/CodexAccountSwitcher/Resources/runtime/login-url");
const { findCodexAssetByPrefix: directFindCodexAssetByPrefix } = require("../Sources/CodexAccountSwitcher/Resources/runtime/asar-assets");
```

Add assertions using the existing fixtures:

```js
test("runtime modules expose auth email and login URL behavior directly", () => {
  assert.equal(directEmailFromAuthString(auth("work@example.com")), "work@example.com");
  assert.equal(new URL(directAccountChooserURL("https://auth.openai.com/oauth/authorize?prompt=none")).searchParams.has("prompt"), false);
});
```

In `test/asar-assets.test.js`, change the existing asset lookup call from the compatibility import to `directFindCodexAssetByPrefix`. `test/public-exports.test.js` continues to verify that the compatibility export remains available.

Run: `node --test test/account-service.test.js test/asar-assets.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for the new runtime modules.

- [ ] **Step 2: Extract path, email, login URL, and asar functions unchanged**

Move the following exact functions from `account-service.js`:

```text
account-paths.js: codexAuthPaths, accountPath, pathExists, normalizeAccountName
auth-email.js: emailFromAuthString, emailFromAuth, jwtPayload
login-url.js: accountChooserURL, openAccountChooserURL, openExternalURL
asar-assets.js: findCodexAssetByPrefix, readAsarHeader, collectAsarFiles, collectAsarNode
```

Export only these public symbols from each module:

```js
// account-paths.js
module.exports = { accountPath, codexAuthPaths, normalizeAccountName, pathExists };

// auth-email.js
module.exports = { emailFromAuthString };

// login-url.js
module.exports = { accountChooserURL, openAccountChooserURL, openExternalURL };

// asar-assets.js
module.exports = { collectAsarFiles, findCodexAssetByPrefix };
```

- [ ] **Step 3: Extract auth store operations**

Move account persistence functions into `auth-store.js` and inject the path/email helpers through imports:

```text
readState, saveCurrentAccount, switchAccount, deleteAccount, startNewLogin,
clearActiveAuth, ensureAutosavedActiveAccount, listAccountNames,
getCurrentAccountName, findMatchingAccountByContents, findMatchingAccountByEmail,
selectVisibleAccounts, readAccountDetails, compareAccountPreference,
accountContentsMatchActive, nextAvailableAccountName, readAccountUsage
```

Export the command-facing operations:

```js
module.exports = {
  clearActiveAuth,
  readState,
  saveCurrentAccount,
  startNewLogin,
  switchAccount,
  deleteAccount,
};
```

- [ ] **Step 4: Rebuild account-service.js as dispatcher plus barrel**

Use imports from the extracted modules. Keep `createAccountService(options)` behavior unchanged, including delayed relaunch and JSON error conversion. End with the original compatibility surface:

```js
module.exports = {
  accountChooserURL,
  collectAsarFiles,
  createAccountService,
  codexAuthPaths,
  findCodexAssetByPrefix,
  normalizeAccountName,
  emailFromAuthString,
  openAccountChooserURL,
};
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test test/account-service.test.js test/asar-assets.test.js test/public-exports.test.js`

Expected: all focused tests pass.

Run: `npm test`

Run: `npm run check`

Run: `swift test`

Expected: 40 Node tests pass, syntax checking succeeds, and 5 Swift tests pass.

```bash
git add Sources/CodexAccountSwitcher/Resources/runtime test
git commit -m "refactor: split account runtime modules"
```

### Task 5: Extract CDP Modules Behind The Compatibility Barrel

**Files:**
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/http.js`
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/targets.js`
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/session.js`
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/inject.js`
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/processes.js`
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/launcher.js`
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/bridge-client.js`
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/status.js`
- Modify: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp.js`
- Test: `test/cdp-targets.test.js`
- Test: `test/cdp-launch.test.js`
- Test: `test/public-exports.test.js`

- [ ] **Step 1: Add direct module tests and verify RED**

Add direct imports:

```js
const { pickCodexTarget: directPickCodexTarget } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/targets");
const { codexLaunchArgs: directCodexLaunchArgs } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/launcher");
const { codexMainProcessIds: directCodexMainProcessIds } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/processes");
```

Change the existing target, launch-args, and process-ID assertions to call `directPickCodexTarget`, `directCodexLaunchArgs`, and `directCodexMainProcessIds`. `test/public-exports.test.js` continues to cover the compatibility barrel.

Run: `node --test test/cdp-targets.test.js test/cdp-launch.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for the new CDP modules.

- [ ] **Step 2: Extract HTTP and target selection**

Move exact functions unchanged:

```text
cdp/http.js: fetchJSON, listTargets, isDebugPortReady, cdpStatus
cdp/targets.js: targetWebSocket, codexPageTargets, pickCodexTarget
```

Wire `http.js` to import `pickCodexTarget` from `targets.js`. Export:

```js
// cdp/http.js
module.exports = { cdpStatus, fetchJSON, isDebugPortReady, listTargets };

// cdp/targets.js
module.exports = { codexPageTargets, pickCodexTarget, targetWebSocket };
```

- [ ] **Step 3: Extract CdpSession and injection**

Move `CdpSession` into `cdp/session.js` and export it:

```js
module.exports = { CdpSession };
```

Move these functions into `cdp/inject.js`:

```text
rendererInjectionSource, injectRenderer, injectRenderers, injectTarget
```

Inject dependencies through CommonJS imports from `http.js`, `targets.js`, and `session.js`. Export:

```js
module.exports = {
  injectRenderer,
  injectRenderers,
  injectTarget,
  rendererInjectionSource,
};
```

Update the `CDP injection refreshes the renderer binding and allows runtime eval under CSP` test to read `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/inject.js`. Its assertions for `Runtime.removeBinding` and `allowUnsafeEvalBlockedByCSP` remain unchanged.

- [ ] **Step 4: Extract process and launcher functions**

Move process functions into `cdp/processes.js`:

```text
isCodexMainProcessCommand, codexProcessListHasMainCommand,
codexMainProcessIds, runningCodexMainProcessIds, isCodexRunning,
quitCodex, waitForCodexExit, terminateCodexMainProcesses
```

Move launcher functions into `cdp/launcher.js`:

```text
DEFAULT_DEBUG_PORT, codexDebugArgs, codexLaunchArgs, launchCodex,
ensureCodexLaunched, chooseDebugPortForLaunch, portIsAvailable,
findAvailablePort, sleep
```

Export the same public functions currently exposed by `cdp.js`; keep internal helpers private unless direct tests require them.

- [ ] **Step 5: Extract bridge client and status shaping**

Move bridge client functions into `cdp/bridge-client.js`:

```text
queryBridge, waitForBridge, startBridgeDaemon
```

Move app validation/status functions into `cdp/status.js`:

```text
ensureCodexApp, readCodexVersion, makeStatusPayload
```

Pass `isCodexRunning` into `status.js` through a normal import from `processes.js`.

- [ ] **Step 6: Replace cdp.js with a compatibility barrel**

Require each extracted module and explicitly preserve the original public surface:

```js
"use strict";

const http = require("./cdp/http");
const targets = require("./cdp/targets");
const inject = require("./cdp/inject");
const processes = require("./cdp/processes");
const launcher = require("./cdp/launcher");
const bridgeClient = require("./cdp/bridge-client");
const status = require("./cdp/status");

module.exports = {
  DEFAULT_DEBUG_PORT: launcher.DEFAULT_DEBUG_PORT,
  cdpStatus: http.cdpStatus,
  chooseDebugPortForLaunch: launcher.chooseDebugPortForLaunch,
  codexDebugArgs: launcher.codexDebugArgs,
  codexLaunchArgs: launcher.codexLaunchArgs,
  codexMainProcessIds: processes.codexMainProcessIds,
  codexPageTargets: targets.codexPageTargets,
  codexProcessListHasMainCommand: processes.codexProcessListHasMainCommand,
  ensureCodexApp: status.ensureCodexApp,
  ensureCodexLaunched: launcher.ensureCodexLaunched,
  findAvailablePort: launcher.findAvailablePort,
  injectRenderer: inject.injectRenderer,
  injectRenderers: inject.injectRenderers,
  isCodexMainProcessCommand: processes.isCodexMainProcessCommand,
  isCodexRunning: processes.isCodexRunning,
  isDebugPortReady: http.isDebugPortReady,
  launchCodex: launcher.launchCodex,
  listTargets: http.listTargets,
  makeStatusPayload: status.makeStatusPayload,
  pickCodexTarget: targets.pickCodexTarget,
  portIsAvailable: launcher.portIsAvailable,
  queryBridge: bridgeClient.queryBridge,
  quitCodex: processes.quitCodex,
  readCodexVersion: status.readCodexVersion,
  rendererInjectionSource: inject.rendererInjectionSource,
  sleep: launcher.sleep,
  startBridgeDaemon: bridgeClient.startBridgeDaemon,
  waitForBridge: bridgeClient.waitForBridge,
};
```

Do not export `CdpSession`, `fetchJSON`, `targetWebSocket`, or `injectTarget` from the compatibility barrel because they were not public before this refactor.

- [ ] **Step 7: Verify GREEN and commit**

Run: `node --test test/cdp-targets.test.js test/cdp-launch.test.js test/public-exports.test.js`

Expected: all focused tests pass and the public export list is unchanged.

Run: `npm test`

Run: `npm run check`

Run: `swift test`

Expected: 40 Node tests pass, syntax checking succeeds, and 5 Swift tests pass.

```bash
git add Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp.js \
  Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp test
git commit -m "refactor: split CDP helper modules"
```

### Task 6: Extract Bridge State, Browser Session, And HTTP Helpers

**Files:**
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge/state.js`
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge/browser-session.js`
- Create: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge/http-server.js`
- Modify: `Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge-server.js`
- Test: `test/bridge-server.test.js`
- Test: `test/public-exports.test.js`

- [ ] **Step 1: Add bridge state tests and verify RED**

Append to `test/bridge-server.test.js`:

```js
const { createBridgeState } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge/state");

test("bridge state closes sessions and tracks a debug port change", () => {
  const closed = [];
  const state = createBridgeState(57330);
  state.sessions.set("main", { closed: false, close: () => closed.push("main") });
  state.setDebugPort(57331);
  const options = state.runtimeOptions({ codexApp: "/Applications/Codex.app", debugPort: 57330 });
  state.closeSessions();

  assert.equal(state.debugPort, 57331);
  assert.equal(options.debugPort, 57331);
  assert.deepEqual(closed, ["main"]);
  assert.equal(state.sessions.size, 0);
});
```

Run: `node --test test/bridge-server.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for `bridge/state`.

- [ ] **Step 2: Implement bridge state**

Create `bridge/state.js`:

```js
"use strict";

function createBridgeState(debugPort) {
  const state = {
    sessions: new Map(),
    lastError: null,
    injectedAt: null,
    launching: false,
    debugPort,
    setDebugPort(port) { state.debugPort = port; },
    runtimeOptions(options) { return { ...options, debugPort: state.debugPort }; },
    activeSessionCount() {
      let count = 0;
      for (const session of state.sessions.values()) if (!session.closed) count += 1;
      return count;
    },
    closeSessions() {
      for (const session of state.sessions.values()) session.close();
      state.sessions.clear();
    },
  };
  return state;
}

module.exports = { createBridgeState };
```

- [ ] **Step 3: Extract browser-session and HTTP helpers**

Move `codexBrowserSessionPaths` and `clearCodexBrowserLoginState` unchanged into `bridge/browser-session.js` and export both.

Move `writeJSON` into `bridge/http-server.js` and export it:

```js
module.exports = { writeJSON };
```

- [ ] **Step 4: Rewire bridge-server.js**

Replace local state variables with `createBridgeState(options.debugPort)`. Use `state.debugPort` for all CDP operations and update it after `chooseDebugPortForLaunch`:

```js
const nextDebugPort = await chooseDebugPortForLaunch(state.debugPort);
if (nextDebugPort !== state.debugPort) {
  log(`debug port ${state.debugPort} unavailable; switching to ${nextDebugPort}`);
  state.setDebugPort(nextDebugPort);
}
```

Build status payload options from the live state so port changes are reported correctly:

```js
state.runtimeOptions(options)
```

Pass `state.runtimeOptions(options)` to `makeStatusPayload`, use `state.debugPort` in `cdpStatus`, `ensureCodexLaunched`, `ensureInjectableTarget`, and `injectRenderers`, and pass `state.sessions` into `injectRenderers`.

Keep the public `bridge-server.js` exports unchanged by re-exporting browser-session functions:

```js
module.exports = {
  clearCodexBrowserLoginState,
  cdpTargetNotReadyMessage,
  codexBrowserSessionPaths,
  serveBridge,
};
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test test/bridge-server.test.js test/public-exports.test.js`

Expected: all focused tests pass.

Run: `npm test`

Run: `npm run check`

Run: `swift test`

Expected: 41 Node tests pass, syntax checking succeeds, and 5 Swift tests pass.

```bash
git add Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge-server.js \
  Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge test
git commit -m "refactor: split bridge server modules"
```

### Task 7: Expand Syntax Checking And Run Final Verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Make syntax checking recursive**

Replace the `check` script in `package.json`:

```json
"check": "find Sources/CodexAccountSwitcher/Resources -name '*.js' -print0 | xargs -0 -n1 node --check"
```

- [ ] **Step 2: Document the focused test layout**

Add this paragraph after the Build And Test command block in `README.md`:

```markdown
Node tests are grouped by account runtime, asar assets, CDP targets and launch,
bridge behavior, renderer source guardrails, and public export compatibility.
Run one suite directly with `node --test test/<suite>.test.js`.
```

- [ ] **Step 3: Run complete verification**

Run each command separately:

```bash
npm test
npm run check
swift test
swift build
scripts/package-app.sh
```

Expected:

```text
Node: 41 tests pass, 0 fail
Node syntax: exit 0 for every JS file under Resources
Swift: 5 tests pass, 0 fail
Swift debug build: exit 0
macOS app package: dist/CodexAccountSwitcher.app created
```

- [ ] **Step 4: Check compatibility status without mutating Codex.app**

Run:

```bash
dist/CodexAccountSwitcher.app/Contents/MacOS/CodexAccountSwitcher --status-json
```

Expected: valid JSON with `status.mode` equal to `"cdp"`. A stopped bridge may report `isInjected: false`; that is valid for this non-mutating status check.

- [ ] **Step 5: Commit documentation and tooling**

```bash
git add package.json README.md
git commit -m "chore: verify all bundled JavaScript modules"
```

- [ ] **Step 6: Confirm the worktree is clean**

Run: `git status --short`

Expected: no output.
