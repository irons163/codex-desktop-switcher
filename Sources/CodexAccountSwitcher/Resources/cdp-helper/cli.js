#!/usr/bin/env node
"use strict";

const {
  cdpStatus,
  ensureCodexApp,
  findAvailablePort,
  makeStatusPayload,
  queryBridge,
  readCodexVersion,
  startBridgeDaemon,
} = require("./lib/cdp");
const { serveBridge } = require("./lib/bridge-server");

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const resolved = resolveOptions(options);
  try {
    if (!command) throw Object.assign(new Error("Missing command."), { code: "usage" });
    ensureCodexApp(resolved.codexApp);

    if (command === "serve") {
      await serveBridge({ ...resolved, autoLaunch: Boolean(options["auto-launch"]) });
      return;
    }

    let payload;
    if (command === "status") {
      payload = await statusPayload(resolved);
    } else if (command === "launch" || command === "install") {
      resolved.debugPort = await launchDebugPort(resolved);
      await startBridgeDaemon({ ...resolved, autoLaunch: false });
      const bridge = await queryBridge(resolved.bridgePort, "/launch", "POST", 60000);
      payload = await statusPayload(resolved, bridge);
    } else if (command === "inject" || command === "repair") {
      await startBridgeDaemon({ ...resolved, autoLaunch: false });
      const bridge = await queryBridge(resolved.bridgePort, "/inject", "POST");
      payload = await statusPayload(resolved, bridge);
    } else if (command === "stop" || command === "uninstall") {
      try {
        await queryBridge(resolved.bridgePort, "/stop", "POST");
      } catch {}
      await waitForBridgeExit(resolved.bridgePort);
      payload = {
        ok: true,
        state: { stoppedAt: new Date().toISOString() },
        status: makeStatusPayload(resolved, null, await cdpStatus(resolved.debugPort)),
      };
    } else {
      throw Object.assign(new Error(`Unknown command: ${command}`), { code: "usage" });
    }
    writeJSON(payload);
    process.exitCode = payload.ok ? 0 : 1;
  } catch (error) {
    writeJSON({
      ok: false,
      error: {
        message: error && error.message ? error.message : String(error),
        code: error && error.code ? String(error.code) : undefined,
      },
    });
    process.exitCode = 1;
  }
}

async function waitForBridgeExit(bridgePort, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await queryBridge(bridgePort);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for account switcher bridge on port ${bridgePort} to stop.`);
}

async function statusPayload(options, knownBridge = null) {
  let bridge = knownBridge;
  if (!bridge) {
    try {
      bridge = await queryBridge(options.bridgePort);
    } catch {}
  }
  if (bridge?.status) {
    return {
      ok: true,
      status: bridge.status,
      state: {
        launchedAt: bridge.injectedAt || null,
        signingMode: "none",
        bridgePort: bridge.status.bridgePort,
        debugPort: bridge.status.debugPort,
      },
    };
  }
  const cdp = await cdpStatus(options.debugPort);
  return {
    ok: true,
    status: makeStatusPayload(options, bridge, cdp),
    state: bridge ? {
      launchedAt: bridge.injectedAt || null,
      signingMode: "none",
      bridgePort: options.bridgePort,
      debugPort: options.debugPort,
    } : null,
  };
}

async function launchDebugPort(options) {
  if (options.debugPortExplicit) return options.debugPort;
  try {
    const currentStatus = await cdpStatus(options.debugPort);
    if (currentStatus.hasCodexTarget) return options.debugPort;
  } catch {}
  try {
    const bridge = await queryBridge(options.bridgePort);
    const current = Number(bridge?.status?.debugPort);
    if (Number.isInteger(current) && current > 0) return current;
  } catch {}
  return findAvailablePort(options.debugPort);
}

function resolveOptions(options) {
  return {
    cliPath: __filename,
    codexApp: options["codex-app"] || "/Applications/Codex.app",
    userRoot: options["user-root"] || `${process.env.HOME}/Library/Application Support/codex-account-switcher`,
    debugPort: Number(options["debug-port"] || process.env.CODEX_ACCOUNT_SWITCHER_DEBUG_PORT || 57330),
    debugPortExplicit: Boolean(options["debug-port"] || process.env.CODEX_ACCOUNT_SWITCHER_DEBUG_PORT),
    bridgePort: Number(options["bridge-port"] || process.env.CODEX_ACCOUNT_SWITCHER_BRIDGE_PORT || 57322),
    readCodexVersion,
  };
}

function parseArgs(args) {
  const out = { command: null, options: {} };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!out.command && !arg.startsWith("--")) {
      out.command = arg;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "json" || key === "quiet" || key === "auto-launch") {
        out.options[key] = true;
      } else {
        out.options[key] = args[index + 1];
        index += 1;
      }
    }
  }
  return out;
}

function writeJSON(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main();
