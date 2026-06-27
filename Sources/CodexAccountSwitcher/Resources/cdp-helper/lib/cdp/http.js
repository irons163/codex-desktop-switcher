"use strict";

const { pickCodexTarget } = require("./targets");

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

module.exports = { cdpStatus, fetchJSON, isDebugPortReady, listTargets };
