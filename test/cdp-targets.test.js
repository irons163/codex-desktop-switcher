"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  codexPageTargets,
  pickCodexTarget,
} = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp");

test("CDP target picker prefers Codex renderer pages", () => {
  const target = pickCodexTarget([
    { id: "one", type: "page", title: "Other", url: "app://-/index.html", webSocketDebuggerUrl: "ws://one" },
    { id: "two", type: "page", title: "Codex", url: "app://-/index.html", webSocketDebuggerUrl: "ws://two" },
  ]);

  assert.equal(target.id, "two");
});

test("CDP target picker prefers the main Codex page over avatar overlay", () => {
  const target = pickCodexTarget([
    { id: "overlay", type: "page", title: "Codex", url: "app://-/index.html?initialRoute=%2Favatar-overlay", webSocketDebuggerUrl: "ws://overlay" },
    { id: "main", type: "page", title: "Codex", url: "app://-/index.html", webSocketDebuggerUrl: "ws://main" },
  ]);

  assert.equal(target.id, "main");
});

test("CDP injection includes every Codex app page target", () => {
  const targets = codexPageTargets([
    { id: "overlay", type: "page", title: "Codex", url: "app://-/index.html?initialRoute=%2Favatar-overlay", webSocketDebuggerUrl: "ws://overlay" },
    { id: "main", type: "page", title: "Codex", url: "app://-/index.html", webSocketDebuggerUrl: "ws://main" },
    { id: "worker", type: "worker", title: "", url: "", webSocketDebuggerUrl: "ws://worker" },
    { id: "web", type: "page", title: "Other", url: "https://example.com", webSocketDebuggerUrl: "ws://web" },
  ]);

  assert.deepEqual(targets.map((target) => target.id), ["overlay", "main"]);
});
