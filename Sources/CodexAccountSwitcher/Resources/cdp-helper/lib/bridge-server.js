"use strict";

const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");

const { createAccountService } = require("../../runtime/account-service");
const {
  chooseDebugPortForLaunch,
  cdpStatus,
  ensureCodexLaunched,
  injectRenderers,
  makeStatusPayload,
  quitCodex,
} = require("./cdp");

async function serveBridge(options) {
  fs.mkdirSync(path.join(options.userRoot, "log"), { recursive: true });
  const logPath = path.join(options.userRoot, "log", "bridge.log");
  const log = (message) => {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  };
  log(`bridge options codexApp=${options.codexApp} debugPort=${options.debugPort} bridgePort=${options.bridgePort} autoLaunch=${Boolean(options.autoLaunch)}`);

  const sessions = new Map();
  let lastError = null;
  let injectedAt = null;
  let launching = false;

  const relaunch = (launchOptions = {}) => {
    launchAndInject(launchOptions).catch((error) => {
      lastError = error.message || String(error);
      log(`relaunch failed: ${lastError}`);
    });
  };
  const service = createAccountService({ home: os.homedir(), relaunch, codexApp: options.codexApp });

  async function injectOnce() {
    await ensureInjectableTarget(options.debugPort);
    await injectRenderers(options.debugPort, service, log, sessions);
    injectedAt = new Date().toISOString();
    lastError = null;
    return sessions;
  }

  async function launchAndInject(launchOptions = {}) {
    if (launching) return;
    launching = true;
    try {
      closeSessions();
      const nextDebugPort = await chooseDebugPortForLaunch(options.debugPort);
      if (nextDebugPort !== options.debugPort) {
        log(`debug port ${options.debugPort} unavailable; switching to ${nextDebugPort}`);
        options.debugPort = nextDebugPort;
      }
      if (launchOptions.forceRelaunch || launchOptions.clearBrowserSession) {
        await quitCodex();
      }
      if (launchOptions.clearBrowserSession) {
        await clearCodexBrowserLoginState(os.homedir(), log);
      }
      await ensureCodexLaunched(options.codexApp, options.debugPort);
      await injectOnce();
    } finally {
      launching = false;
    }
  }

  async function bridgeStatus() {
    const cdp = await cdpStatus(options.debugPort);
    return {
      app: "codex-account-switcher",
      ok: true,
      injected: activeSessionCount() > 0,
      injectedAt,
      lastError,
      launching,
      status: makeStatusPayload(options, { ok: true, injected: activeSessionCount() > 0, lastError }, cdp),
    };
  }

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      lastError = error.message || String(error);
      log(`request failed: ${lastError}`);
      writeJSON(response, 500, { ok: false, error: { message: lastError } });
    });
  });

  async function handleRequest(request, response) {
    if (request.method === "GET" && request.url === "/status") {
      writeJSON(response, 200, await bridgeStatus());
      return;
    }
    if (request.method === "POST" && request.url === "/launch") {
      await launchAndInject();
      writeJSON(response, 200, await bridgeStatus());
      return;
    }
    if (request.method === "POST" && request.url === "/inject") {
      await injectOnce();
      writeJSON(response, 200, await bridgeStatus());
      return;
    }
    if (request.method === "POST" && request.url === "/stop") {
      writeJSON(response, 200, { app: "codex-account-switcher", ok: true, stopped: true });
      server.close(() => process.exit(0));
      return;
    }
    writeJSON(response, 404, { ok: false, error: { message: "Not found" } });
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.bridgePort, "127.0.0.1", resolve);
  });

  setInterval(() => {
    if (launching) return;
    cdpStatus(options.debugPort)
      .then((status) => status.hasCodexTarget ? injectOnce() : null)
      .catch((error) => {
        lastError = error.message || String(error);
      });
  }, 3000).unref();

  if (options.autoLaunch) {
    launchAndInject().catch((error) => {
      lastError = error.message || String(error);
      log(`auto launch failed: ${lastError}`);
    });
  }

  log(`bridge listening on 127.0.0.1:${options.bridgePort}, debug port ${options.debugPort}`);

  function activeSessionCount() {
    let count = 0;
    for (const session of sessions.values()) {
      if (!session.closed) count += 1;
    }
    return count;
  }

  function closeSessions() {
    for (const session of sessions.values()) session.close();
    sessions.clear();
  }
}

async function ensureInjectableTarget(debugPort) {
  const status = await cdpStatus(debugPort);
  if (status.isDebugPortReady && status.hasCodexTarget) return;
  throw new Error(cdpTargetNotReadyMessage(status, debugPort));
}

function cdpTargetNotReadyMessage(status, debugPort) {
  if (!status?.isDebugPortReady) {
    return `Codex is not accepting CDP connections on debug port ${debugPort}. Use Launch + Inject to restart Codex with debugging enabled.`;
  }
  return `Codex CDP is running on debug port ${debugPort}, but no Codex renderer target was found. Use Launch + Inject to restart Codex and attach again.`;
}

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

function writeJSON(response, statusCode, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

module.exports = {
  clearCodexBrowserLoginState,
  cdpTargetNotReadyMessage,
  codexBrowserSessionPaths,
  serveBridge,
};
