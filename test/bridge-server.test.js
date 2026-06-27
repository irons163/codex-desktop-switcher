"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { withTempHome } = require("./support/fixtures");
const { cdpTargetNotReadyMessage } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge-server");

test("bridge explains when reinject cannot attach to a debug target", () => {
  assert.match(
    cdpTargetNotReadyMessage({ isDebugPortReady: false, hasCodexTarget: false }, 57330),
    /Launch \+ Inject/,
  );
});

test("bridge clears Codex browser login state for fresh account login", async () => {
  const {
    clearCodexBrowserLoginState,
    codexBrowserSessionPaths,
  } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge-server");
  await withTempHome(async (home) => {
    const paths = codexBrowserSessionPaths(home);
    await fs.mkdir(paths.userDataDir, { recursive: true });
    await fs.writeFile(path.join(paths.userDataDir, "Cookies"), "");
    await fs.writeFile(path.join(paths.userDataDir, "Cookies-journal"), "");
    await fs.mkdir(path.join(paths.userDataDir, "Session Storage"), { recursive: true });
    await fs.writeFile(path.join(paths.userDataDir, "Session Storage", "CURRENT"), "");

    await clearCodexBrowserLoginState(home);

    await assert.rejects(() => fs.access(path.join(paths.userDataDir, "Cookies")));
    await assert.rejects(() => fs.access(path.join(paths.userDataDir, "Session Storage")));
  });
});

const { createBridgeState } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge/state");

test("bridge state closes sessions and tracks a debug port change", () => {
  const closed = [];
  const state = createBridgeState(57330);
  state.sessions.set("main", { closed: false, close: () => closed.push("main") });
  state.sessions.set("closed", { closed: true, close: () => closed.push("closed") });
  state.setDebugPort(57331);
  const options = state.runtimeOptions({ codexApp: "/Applications/Codex.app", debugPort: 57330 });
  assert.equal(state.activeSessionCount(), 1);
  state.closeSessions();

  assert.equal(state.debugPort, 57331);
  assert.equal(options.debugPort, 57331);
  assert.deepEqual(closed, ["main", "closed"]);
  assert.equal(state.sessions.size, 0);
});
