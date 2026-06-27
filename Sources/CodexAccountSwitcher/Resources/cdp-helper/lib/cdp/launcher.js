"use strict";

const childProcess = require("node:child_process");
const net = require("node:net");
const { cdpStatus } = require("./http");
const { isCodexRunning, quitCodex } = require("./processes");

const DEFAULT_DEBUG_PORT = 57330;

function codexDebugArgs(debugPort) {
  return [
    `--remote-debugging-port=${debugPort}`,
    `--remote-allow-origins=http://127.0.0.1:${debugPort}`,
  ];
}

function codexLaunchArgs(codexApp, debugPort) {
  return [codexApp, "--args", ...codexDebugArgs(debugPort)];
}

async function launchCodex(codexApp, debugPort) {
  childProcess.spawn("open", codexLaunchArgs(codexApp, debugPort), {
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

async function chooseDebugPortForLaunch(preferredPort) {
  try {
    const status = await cdpStatus(preferredPort);
    if (status.hasCodexTarget) return preferredPort;
  } catch {}
  if (await portIsAvailable(preferredPort)) return preferredPort;
  return findAvailablePort(preferredPort + 1);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  DEFAULT_DEBUG_PORT,
  chooseDebugPortForLaunch,
  codexDebugArgs,
  codexLaunchArgs,
  ensureCodexLaunched,
  findAvailablePort,
  launchCodex,
  portIsAvailable,
  sleep,
};
