"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_DEBUG_PORT = 57330;

function codexDebugArgs(debugPort) {
  return [
    `--remote-debugging-port=${debugPort}`,
    `--remote-allow-origins=http://127.0.0.1:${debugPort}`,
  ];
}

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

async function listTargets(debugPort) {
  return fetchJSON(`http://127.0.0.1:${debugPort}/json`);
}

async function isDebugPortReady(debugPort) {
  try {
    await fetchJSON(`http://127.0.0.1:${debugPort}/json/version`);
    return true;
  } catch {
    return false;
  }
}

async function fetchJSON(url, timeoutMs = 1000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`CDP query failed: ${response.status}`);
  return response.json();
}

function targetWebSocket(target) {
  return target.webSocketDebuggerUrl || target.web_socket_debugger_url || null;
}

function pickCodexTarget(targets) {
  const injectable = codexPageTargets(targets);
  const mainCodex = injectable.find((target) => {
    const url = String(target.url || "");
    const title = String(target.title || "").toLowerCase();
    return title.includes("codex") && url === "app://-/index.html";
  });
  const appMain = injectable.find((target) => {
    const url = String(target.url || "");
    return url.startsWith("app://-/index.html") && !url.includes("avatar-overlay");
  });
  const codex = injectable.find((target) => {
    const haystack = `${target.title || ""} ${target.url || ""}`.toLowerCase();
    return haystack.includes("codex");
  });
  const appPage = injectable.find((target) => String(target.url || "").startsWith("app://"));
  const selected = mainCodex || appMain || codex || appPage || injectable[0];
  if (!selected) {
    const error = new Error("No injectable Codex renderer target found.");
    error.code = "missing-cdp-target";
    throw error;
  }
  return selected;
}

function codexPageTargets(targets) {
  return targets.filter((target) => {
    if (target.type !== "page" || !targetWebSocket(target)) return false;
    const url = String(target.url || "");
    return url.startsWith("app://-/index.html");
  });
}

async function cdpStatus(debugPort) {
  const ready = await isDebugPortReady(debugPort);
  if (!ready) {
    return { isDebugPortReady: false, hasCodexTarget: false };
  }
  try {
    const targets = await listTargets(debugPort);
    pickCodexTarget(targets);
    return { isDebugPortReady: true, hasCodexTarget: true };
  } catch {
    return { isDebugPortReady: true, hasCodexTarget: false };
  }
}

function rendererInjectionSource() {
  return fs.readFileSync(path.resolve(__dirname, "..", "renderer-inject.js"), "utf8");
}

async function injectRenderer(debugPort, accountService, logger = () => {}) {
  const targets = await listTargets(debugPort);
  const target = pickCodexTarget(targets);
  return injectTarget(target, accountService, logger);
}

async function injectRenderers(debugPort, accountService, logger = () => {}, existingSessions = new Map()) {
  const targets = await listTargets(debugPort);
  const sessions = [];
  for (const target of codexPageTargets(targets)) {
    if (existingSessions.has(target.id) && !existingSessions.get(target.id).closed) {
      sessions.push(existingSessions.get(target.id));
      continue;
    }
    try {
      const session = await injectTarget(target, accountService, logger);
      existingSessions.set(target.id, session);
      sessions.push(session);
    } catch (error) {
      logger(`inject target ${target.id} failed: ${error.message}`);
    }
  }
  if (!sessions.length) throw new Error("No Codex app page target accepted injection.");
  return sessions;
}

async function injectTarget(target, accountService, logger = () => {}) {
  const websocketURL = targetWebSocket(target);
  const source = rendererInjectionSource();
  const session = await CdpSession.connect(websocketURL, accountService, logger);
  await session.send("Runtime.enable");
  await session.send("Page.enable");
  try {
    await session.send("Runtime.removeBinding", { name: "__codexAccountSwitcherBridge" });
  } catch {}
  await session.send("Runtime.addBinding", { name: "__codexAccountSwitcherBridge" });
  await session.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await session.send("Runtime.evaluate", {
    expression: source,
    awaitPromise: false,
    allowUnsafeEvalBlockedByCSP: true,
  });
  return session;
}

class CdpSession {
  constructor(socket, accountService, logger) {
    this.socket = socket;
    this.accountService = accountService;
    this.logger = logger;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const [, pending] of this.pending) pending.reject(new Error("CDP websocket closed"));
      this.pending.clear();
    });
    socket.addEventListener("error", (event) => {
      this.logger(`CDP websocket error: ${event.message || "unknown"}`);
    });
  }

  static connect(websocketURL, accountService, logger) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketURL);
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to CDP websocket.")), 5000);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve(new CdpSession(socket, accountService, logger));
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Failed to connect to CDP websocket."));
      }, { once: true });
    });
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP websocket is closed."));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP command ${method}.`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(payload);
    });
  }

  async handleMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(`CDP command ${pending.method} failed: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result || {});
      return;
    }

    if (message.method === "Runtime.bindingCalled" && message.params?.name === "__codexAccountSwitcherBridge") {
      await this.handleBridgeCall(message.params.payload);
    }
  }

  async handleBridgeCall(rawPayload) {
    let request;
    try {
      request = JSON.parse(rawPayload);
    } catch (error) {
      this.logger(`Bridge payload decode failed: ${error.message}`);
      return;
    }
    const id = request.id;
    const message = request.message || {};
    const result = await this.accountService.handle(message);
    const expression = `window.__codexAccountSwitcherReceive && window.__codexAccountSwitcherReceive(${JSON.stringify(id)}, ${JSON.stringify(result)});`;
    try {
      await this.send("Runtime.evaluate", {
        expression,
        awaitPromise: false,
        allowUnsafeEvalBlockedByCSP: true,
      });
    } catch (error) {
      this.logger(`Bridge response failed: ${error.message}`);
    }
  }

  close() {
    this.closed = true;
    try { this.socket.close(); } catch {}
  }
}

function isCodexMainProcessCommand(command) {
  return /\/Codex\.app\/Contents\/MacOS\/Codex(?:\s|$)/.test(String(command || ""));
}

function codexProcessListHasMainCommand(output) {
  return String(output || "")
    .split(/\r?\n/)
    .some((line) => isCodexMainProcessCommand(line));
}

function isCodexRunning() {
  const result = childProcess.spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (result.status !== 0 && !result.stdout) return false;
  return codexProcessListHasMainCommand(result.stdout);
}

async function quitCodex() {
  childProcess.spawnSync("osascript", ["-e", "tell application \"Codex\" to quit"], { stdio: "ignore" });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (!isCodexRunning()) return;
    await sleep(250);
  }
}

async function launchCodex(codexApp, debugPort) {
  childProcess.spawn("open", ["-na", codexApp, "--args", ...codexDebugArgs(debugPort)], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

async function ensureCodexLaunched(codexApp, debugPort) {
  if ((await cdpStatus(debugPort)).hasCodexTarget) return { launched: false };
  if (isCodexRunning()) await quitCodex();
  await launchCodex(codexApp, debugPort);
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < 20000) {
    try {
      if ((await cdpStatus(debugPort)).hasCodexTarget) return { launched: true };
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError || new Error(`Timed out waiting for Codex CDP target on port ${debugPort}.`);
}

async function queryBridge(bridgePort, pathname = "/status", method = "GET") {
  const response = await fetch(`http://127.0.0.1:${bridgePort}${pathname}`, {
    method,
    signal: AbortSignal.timeout(5000),
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

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort = DEFAULT_DEBUG_PORT) {
  for (let port = startPort; port < startPort + 200; port += 1) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`No free local debug port found starting at ${startPort}.`);
}

async function waitForBridge(bridgePort, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await queryBridge(bridgePort);
      if (status?.app === "codex-account-switcher") return status;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw lastError || new Error(`Timed out waiting for account switcher bridge on port ${bridgePort}.`);
}

async function startBridgeDaemon(options) {
  try {
    return await waitForBridge(options.bridgePort, 500);
  } catch {}

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
  return waitForBridge(options.bridgePort, 5000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

module.exports = {
  codexDebugArgs,
  codexPageTargets,
  DEFAULT_DEBUG_PORT,
  ensureCodexApp,
  readCodexVersion,
  listTargets,
  isDebugPortReady,
  cdpStatus,
  pickCodexTarget,
  rendererInjectionSource,
  injectRenderer,
  injectRenderers,
  codexProcessListHasMainCommand,
  isCodexMainProcessCommand,
  isCodexRunning,
  quitCodex,
  launchCodex,
  ensureCodexLaunched,
  queryBridge,
  waitForBridge,
  portIsAvailable,
  findAvailablePort,
  startBridgeDaemon,
  makeStatusPayload,
  sleep,
};
