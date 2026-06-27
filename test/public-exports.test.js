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
