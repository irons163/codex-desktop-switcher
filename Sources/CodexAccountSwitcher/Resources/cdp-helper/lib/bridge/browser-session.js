"use strict";

const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");

function codexBrowserSessionPaths(home = os.homedir()) {
  const userDataDir = path.join(home, "Library", "Application Support", "Codex");
  const removable = [
    "Cookies",
    "Cookies-journal",
    "Session Storage",
    "Local Storage",
    "SharedStorage",
    "SharedStorage-wal",
    "DIPS",
    "DIPS-wal",
    "Trust Tokens",
    "Trust Tokens-journal",
  ].map((name) => path.join(userDataDir, name));
  return { userDataDir, removable };
}

async function clearCodexBrowserLoginState(home = os.homedir(), logger = () => {}) {
  const { removable } = codexBrowserSessionPaths(home);
  for (const target of removable) {
    try {
      await fsp.rm(target, { recursive: true, force: true });
    } catch (error) {
      logger(`failed to remove Codex browser login state ${target}: ${error.message}`);
    }
  }
}

module.exports = {
  clearCodexBrowserLoginState,
  codexBrowserSessionPaths,
};
