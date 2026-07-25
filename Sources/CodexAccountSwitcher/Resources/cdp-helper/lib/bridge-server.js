"use strict";

const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { createAccountService } = require("../../runtime/account-service");
const {
  chooseDebugPortForLaunch,
  cdpStatus,
  ensureCodexLaunched,
  injectRenderers,
  makeStatusPayload,
  quitCodex,
} = require("./cdp");
const {
  clearCodexBrowserLoginState,
  codexBrowserSessionPaths,
} = require("./bridge/browser-session");
const { writeJSON } = require("./bridge/http-server");
const { createBridgeState } = require("./bridge/state");

async function serveBridge(options) {
  fs.mkdirSync(path.join(options.userRoot, "log"), { recursive: true });
  const logPath = path.join(options.userRoot, "log", "bridge.log");
  const log = (message) => {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  };
  log(`bridge options codexApp=${options.codexApp} debugPort=${options.debugPort} bridgePort=${options.bridgePort} autoLaunch=${Boolean(options.autoLaunch)}`);

  const state = createBridgeState(options.debugPort);

  const relaunch = (launchOptions = {}) => {
    launchAndInject(launchOptions).catch((error) => {
      state.lastError = error.message || String(error);
      log(`relaunch failed: ${state.lastError}`);
    });
  };
  const service = createAccountService({
    home: os.homedir(),
    relaunch,
    codexApp: options.codexApp,
    userRoot: options.userRoot,
  });

  async function injectOnce() {
    await ensureInjectableTarget(state.debugPort);
    await injectRenderers(state.debugPort, service, log, state.sessions);
    state.injectedAt = new Date().toISOString();
    state.lastError = null;
    return state.sessions;
  }

  async function launchAndInject(launchOptions = {}) {
    if (state.launching) return;
    state.launching = true;
    try {
      state.closeSessions();
      const nextDebugPort = await chooseDebugPortForLaunch(state.debugPort);
      if (nextDebugPort !== state.debugPort) {
        log(`debug port ${state.debugPort} unavailable; switching to ${nextDebugPort}`);
        state.setDebugPort(nextDebugPort);
      }
      if (launchOptions.forceRelaunch || launchOptions.clearBrowserSession) {
        await quitCodex();
      }
      if (launchOptions.clearBrowserSession) {
        await clearCodexBrowserLoginState(os.homedir(), log);
      }
      await ensureCodexLaunched(options.codexApp, state.debugPort);
      await injectOnce();
    } finally {
      state.launching = false;
    }
  }

  async function bridgeStatus() {
    const cdp = await cdpStatus(state.debugPort);
    const injected = state.activeSessionCount() > 0;
    return {
      app: "codex-account-switcher",
      ok: true,
      injected,
      injectedAt: state.injectedAt,
      lastError: state.lastError,
      launching: state.launching,
      status: makeStatusPayload(state.runtimeOptions(options), { ok: true, injected, lastError: state.lastError }, cdp),
    };
  }

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      state.lastError = error.message || String(error);
      log(`request failed: ${state.lastError}`);
      writeJSON(response, 500, { ok: false, error: { message: state.lastError } });
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
    if (state.launching) return;
    cdpStatus(state.debugPort)
      .then((status) => status.hasCodexTarget ? injectOnce() : null)
      .catch((error) => {
        state.lastError = error.message || String(error);
      });
  }, 3000).unref();

  if (options.autoLaunch) {
    launchAndInject().catch((error) => {
      state.lastError = error.message || String(error);
      log(`auto launch failed: ${state.lastError}`);
    });
  }

  log(`bridge listening on 127.0.0.1:${options.bridgePort}, debug port ${state.debugPort}`);
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

module.exports = {
  clearCodexBrowserLoginState,
  cdpTargetNotReadyMessage,
  codexBrowserSessionPaths,
  serveBridge,
};
