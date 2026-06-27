"use strict";

const http = require("./cdp/http");
const targets = require("./cdp/targets");
const inject = require("./cdp/inject");
const processes = require("./cdp/processes");
const launcher = require("./cdp/launcher");
const bridgeClient = require("./cdp/bridge-client");
const status = require("./cdp/status");

module.exports = {
  DEFAULT_DEBUG_PORT: launcher.DEFAULT_DEBUG_PORT,
  cdpStatus: http.cdpStatus,
  chooseDebugPortForLaunch: launcher.chooseDebugPortForLaunch,
  codexDebugArgs: launcher.codexDebugArgs,
  codexLaunchArgs: launcher.codexLaunchArgs,
  codexMainProcessIds: processes.codexMainProcessIds,
  codexPageTargets: targets.codexPageTargets,
  codexProcessListHasMainCommand: processes.codexProcessListHasMainCommand,
  ensureCodexApp: status.ensureCodexApp,
  ensureCodexLaunched: launcher.ensureCodexLaunched,
  findAvailablePort: launcher.findAvailablePort,
  injectRenderer: inject.injectRenderer,
  injectRenderers: inject.injectRenderers,
  isCodexMainProcessCommand: processes.isCodexMainProcessCommand,
  isCodexRunning: processes.isCodexRunning,
  isDebugPortReady: http.isDebugPortReady,
  launchCodex: launcher.launchCodex,
  listTargets: http.listTargets,
  makeStatusPayload: status.makeStatusPayload,
  pickCodexTarget: targets.pickCodexTarget,
  portIsAvailable: launcher.portIsAvailable,
  queryBridge: bridgeClient.queryBridge,
  quitCodex: processes.quitCodex,
  readCodexVersion: status.readCodexVersion,
  rendererInjectionSource: inject.rendererInjectionSource,
  sleep: launcher.sleep,
  startBridgeDaemon: bridgeClient.startBridgeDaemon,
  waitForBridge: bridgeClient.waitForBridge,
};
