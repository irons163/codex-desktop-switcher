"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { isCodexRunning } = require("./processes");

function ensureCodexApp(codexApp) {
  const executable = path.join(codexApp, "Contents", "MacOS", "Codex");
  if (!fs.existsSync(executable)) {
    const error = new Error(`Codex.app not found or missing executable: ${codexApp}`);
    error.code = "missing-codex-app";
    throw error;
  }
}

function readCodexVersion(codexApp) {
  const plistPath = path.join(codexApp, "Contents", "Info.plist");
  try {
    return childProcess.execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleShortVersionString", plistPath],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return null;
  }
}

function makeStatusPayload(options, bridge, cdp) {
  return {
    codexPath: options.codexApp,
    codexVersion: readCodexVersion(options.codexApp),
    mode: "cdp",
    isInjected: Boolean(bridge?.injected),
    bridgeRunning: Boolean(bridge?.ok),
    debugPort: options.debugPort,
    bridgePort: options.bridgePort,
    isRunning: isCodexRunning(),
    isDebugPortReady: Boolean(cdp?.isDebugPortReady),
    hasCodexTarget: Boolean(cdp?.hasCodexTarget),
    lastError: bridge?.lastError || null,
  };
}

module.exports = { ensureCodexApp, makeStatusPayload, readCodexVersion };
