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
