"use strict";

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

module.exports = { codexPageTargets, pickCodexTarget, targetWebSocket };
