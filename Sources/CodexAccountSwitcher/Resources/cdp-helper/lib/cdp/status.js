"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { isCodexRunning } = require("./processes");

function ensureCodexApp(codexApp) {
  const executableName = readBundleValue(codexApp, "CFBundleExecutable");
  const candidates = [executableName, "Codex", "ChatGPT"]
    .filter(Boolean)
    .map((name) => path.join(codexApp, "Contents", "MacOS", name));
  if (!candidates.some((candidate) => isExecutable(candidate))) {
    const error = new Error(`Codex desktop app not found or missing executable: ${codexApp}`);
    error.code = "missing-codex-app";
    throw error;
  }
}

function readCodexVersion(codexApp) {
  return readBundleValue(codexApp, "CFBundleShortVersionString");
}

function readBundleValue(codexApp, key) {
  const plistPath = path.join(codexApp, "Contents", "Info.plist");
  try {
    return childProcess.execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print :${key}`, plistPath],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return null;
  }
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
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
