"use strict";

function createBridgeState(debugPort) {
  const state = {
    sessions: new Map(),
    lastError: null,
    injectedAt: null,
    launching: false,
    debugPort,
    setDebugPort(port) { state.debugPort = port; },
    runtimeOptions(options) { return { ...options, debugPort: state.debugPort }; },
    activeSessionCount() {
      let count = 0;
      for (const session of state.sessions.values()) if (!session.closed) count += 1;
      return count;
    },
    closeSessions() {
      for (const session of state.sessions.values()) session.close();
      state.sessions.clear();
    },
  };
  return state;
}

module.exports = { createBridgeState };
