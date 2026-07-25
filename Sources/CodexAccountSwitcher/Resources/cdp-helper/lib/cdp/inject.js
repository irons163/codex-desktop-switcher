"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { listTargets } = require("./http");
const { CdpSession } = require("./session");
const { codexPageTargets, pickCodexTarget, targetWebSocket } = require("./targets");

function rendererInjectionSource() {
  const inject = fs.readFileSync(path.resolve(__dirname, "..", "..", "renderer-inject.js"), "utf8");
  const messages = fs.readFileSync(path.resolve(__dirname, "..", "..", "..", "locales", "messages.json"), "utf8");
  return `window.__codexAccountSwitcherMessages=${messages};\n${inject}`;
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

module.exports = {
  injectRenderer,
  injectRenderers,
  injectTarget,
  rendererInjectionSource,
};
