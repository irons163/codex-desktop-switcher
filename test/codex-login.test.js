"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PassThrough, Writable } = require("node:stream");
const test = require("node:test");
const { createCodexLogin, findCodexCLI } = require("../Sources/CodexAccountSwitcher/Resources/runtime/codex-login");
const { createAccountService } = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");
const { auth, withTempHome } = require("./support/fixtures");
const { openExternalURL } = require("../Sources/CodexAccountSwitcher/Resources/runtime/login-url");

function fakeService({ hang, url = "https://auth.openai.com/oauth/authorize?state=example&prompt=none", failAt } = {}) {
  const children = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.requests = [];
    child.killed = false;
    child.notify = (success = true, loginId = "login-1") => child.stdout.write(`${JSON.stringify({
      method: "account/login/completed", params: { loginId, success },
    })}\n`);
    child.stdin = new Writable({ write(chunk, _, callback) {
      const request = JSON.parse(chunk.toString());
      child.requests.push(request);
      if (request.id && request.method !== hang) queueMicrotask(() => {
        const result = request.method === "account/login/start" ? { type: "chatgpt", loginId: "login-1", authUrl: url } : {};
        child.stdout.write(`${JSON.stringify({ id: request.id, ...(request.method === failAt ? { error: { message: "failed" } } : { result }) })}\n`);
      });
      callback();
    } });
    child.kill = () => { child.killed = true; child.emit("exit", 0); };
    children.push(child);
    return child;
  };
  return { spawn, children };
}

function manager(service, options = {}) {
  return createCodexLogin({ executable: "fixture-codex", spawn: service.spawn, openURL: async () => {}, ...options });
}

test("login opens a fresh official auth URL before waiting for browser completion", async () => {
  const service = fakeService();
  const opened = [];
  let completed = 0;
  const login = manager(service, { openURL: async (url) => opened.push(new URL(url)), onComplete: async () => { completed++; } });
  try {
    assert.deepEqual(await login.start(), { loginPending: true });
    assert.equal(completed, 0);
    assert.equal(opened[0].origin, "https://auth.openai.com");
    assert.equal(opened[0].searchParams.get("max_age"), "0");
    assert.equal(opened[0].searchParams.get("state"), "example");
    assert.equal(opened[0].searchParams.has("prompt"), false);
    assert.deepEqual(service.children[0].requests.map((request) => request.method), ["initialize", "initialized", "account/login/start"]);
    service.children[0].notify(true, "unrelated-login");
    await new Promise(setImmediate);
    assert.equal(completed, 0);
    service.children[0].notify();
    await new Promise(setImmediate);
    assert.equal(completed, 1);
    assert.equal(service.children[0].killed, true);
  } finally { await login.cancel(); }
});

test("hung startup, login RPC, and browser opener time out and stop the service", async () => {
  for (const hang of ["initialize", "account/login/start", "browser"]) {
    const service = fakeService({ hang });
    const login = manager(service, { startupTimeoutMs: 30, openURL: async () => {
      if (hang === "browser") await new Promise(() => {});
    } });
    await assert.rejects(() => login.start(), /timed out|closed/);
    assert.equal(service.children[0].killed, true);
  }
});

test("browser opening errors, unexpected process exit, and login errors are recoverable", async () => {
  const service = fakeService();
  let fail = true;
  const login = manager(service, { openURL: async () => { if (fail) throw new Error("No browser available"); } });
  try {
    await assert.rejects(() => login.start(), /No browser/);
    assert.equal(service.children[0].killed, true);
    fail = false;
    await login.start();
    assert.equal(service.children.length, 2);
  } finally { await login.cancel(); }
  const exited = fakeService({ hang: "initialize" });
  const terminated = manager(exited);
  const start = terminated.start();
  await new Promise(setImmediate);
  exited.children[0].emit("exit", 1);
  await assert.rejects(() => start, /closed|exited/);
  const rpcError = fakeService({ failAt: "account/login/start" });
  await assert.rejects(() => manager(rpcError).start(), /could not start sign-in/);
});

test("new sign-in retries cancel the previous callback listener", async () => {
  const service = fakeService();
  const login = manager(service);
  try {
    await login.start();
    await login.start();
    assert.equal(service.children[0].killed, true);
    assert.ok(service.children[0].requests.some((request) => request.method === "account/login/cancel"));
    assert.equal(service.children[1].killed, false);
  } finally { await login.cancel(); }
});

test("lookalike auth URLs are rejected before any browser is opened", async () => {
  const service = fakeService({ url: "https://auth.openai.com.attacker.example/oauth/authorize" });
  let opened = false;
  const login = manager(service, { openURL: async () => { opened = true; } });
  await assert.rejects(() => login.start(), /official OpenAI HTTPS/);
  assert.equal(opened, false);
  assert.equal(service.children[0].killed, true);
});

test("service preserves active auth on failure and autosaves only after successful sign-in", async () => {
  await withTempHome(async (home) => {
    const native = fakeService();
    const relaunched = [];
    let openFails = true;
    const service = createAccountService({
      home,
      relaunch: (options) => relaunched.push(options),
      openURL: async () => { if (openFails) throw new Error("Browser unavailable"); },
      createLogin: (options) => manager(native, options),
    });
    await fs.mkdir(service.paths.CODEX_DIR, { recursive: true });
    const current = auth("current@example.com");
    await fs.writeFile(service.paths.AUTH_PATH, current);
    try {
      assert.equal((await service.handle({ action: "new-sign-in" })).ok, false);
      assert.equal(await fs.readFile(service.paths.AUTH_PATH, "utf8"), current);
      assert.equal(await fs.readFile(path.join(service.paths.ACCOUNTS_DIR, "account.json"), "utf8"), current);
      openFails = false;
      assert.equal((await service.handle({ action: "new-sign-in" })).ok, true);
      assert.equal(await fs.readFile(service.paths.AUTH_PATH, "utf8"), current);
      assert.equal(relaunched.length, 0);
      // Codex writes the new credentials before sending its completion notification.
      const newAuth = auth("new@example.com");
      await fs.writeFile(service.paths.AUTH_PATH, newAuth);
      native.children.at(-1).notify();
      for (let count = 0; count < 100 && !relaunched.length; count++) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.deepEqual(relaunched, [{ forceRelaunch: true }]);
      assert.equal(await fs.readFile(path.join(service.paths.ACCOUNTS_DIR, "account-2.json"), "utf8"), newAuth);
    } finally { await service.dispose(); }
  });
});

test("desktop-bundled Codex CLI is preferred over PATH", async () => {
  await withTempHome(async (home) => {
    const app = path.join(home, "ChatGPT.app");
    const bundled = path.join(app, "Contents", "Resources", "codex-cli", "bin", "codex");
    await fs.mkdir(path.dirname(bundled), { recursive: true });
    await fs.writeFile(bundled, "#!/bin/sh\n", { mode: 0o755 });
    assert.equal(findCodexCLI(app, { PATH: "/nonexistent" }), bundled);
  });
});

test("browser opener waits for the operating system result and reports rejection", async () => {
  for (const code of [0, 1]) {
    const child = new EventEmitter();
    let finished = false;
    const opened = openExternalURL("https://auth.openai.com/oauth/authorize", (command) => {
      assert.equal(command, "/usr/bin/open");
      return child;
    });
    opened.then(() => { finished = true; }, () => { finished = true; });
    child.emit("spawn");
    await new Promise(setImmediate);
    assert.equal(finished, false);
    child.emit("close", code);
    if (code) await assert.rejects(() => opened, /Could not open the sign-in browser/);
    else await opened;
  }
});
