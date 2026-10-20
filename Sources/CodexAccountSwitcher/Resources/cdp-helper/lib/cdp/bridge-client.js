"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { sleep } = require("./launcher");
const { RUNTIME_VERSION } = require("../runtime-version");

async function queryBridge(bridgePort, pathname = "/status", method = "GET", timeoutMs = 5000) {
  const response = await fetch(`http://127.0.0.1:${bridgePort}${pathname}`, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  let payload = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {}
  if (!response.ok) {
    const message = payload?.error?.message || `Bridge query failed: ${response.status}`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
  if (payload) return payload;
  return {};
}

async function waitForBridge(bridgePort, timeoutMs = 5000, runtimeVersion = null) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await queryBridge(bridgePort);
      if (status?.app === "codex-account-switcher"
        && (!runtimeVersion || status.runtimeVersion === runtimeVersion)) return status;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw lastError || new Error(`Timed out waiting for account switcher bridge on port ${bridgePort}.`);
}

async function startBridgeDaemon(options) {
  let current = null;
  try {
    current = await waitForBridge(options.bridgePort, 500);
  } catch {}
  if (current?.runtimeVersion === RUNTIME_VERSION) return current;
  if (current) {
    await queryBridge(options.bridgePort, "/stop", "POST");
    const stoppedAt = Date.now();
    let stopped = false;
    while (Date.now() - stoppedAt < 5000) {
      try { await queryBridge(options.bridgePort); }
      catch { stopped = true; break; }
      await sleep(100);
    }
    if (!stopped) throw new Error("The previous switcher bridge could not stop. Quit it and try Launch again.");
  }

  await fsp.mkdir(path.join(options.userRoot, "log"), { recursive: true });
  const logPath = path.join(options.userRoot, "log", "bridge.log");
  const logFd = fs.openSync(logPath, "a");
  const args = [
    options.cliPath,
    "serve",
    "--codex-app", options.codexApp,
    "--user-root", options.userRoot,
    "--debug-port", String(options.debugPort),
    "--bridge-port", String(options.bridgePort),
  ];
  if (options.autoLaunch) args.push("--auto-launch");
  const child = childProcess.spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, CODEX_ACCOUNT_SWITCHER_BRIDGE: "1" },
  });
  child.unref();
  fs.closeSync(logFd);
  return waitForBridge(options.bridgePort, 5000, RUNTIME_VERSION);
}

module.exports = { queryBridge, startBridgeDaemon, waitForBridge };
