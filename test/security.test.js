"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { auth, withTempHome } = require("./support/fixtures");
const { isTrustedBridgeRequest } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge/http-server");
const { CdpSession } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/session");
const { codexPageTargets } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp/targets");
const { createAccountService, accountChooserURL } = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");

test("bridge rejects cross-origin, null-origin, and DNS-rebinding requests", () => {
  const port = 57322;
  const trusted = { host: `127.0.0.1:${port}` };
  assert.equal(isTrustedBridgeRequest({ headers: trusted }, port), true);
  assert.equal(isTrustedBridgeRequest({ headers: { host: `localhost:${port}` } }, port), true);
  for (const headers of [
    { ...trusted, origin: "https://attacker.example" },
    { ...trusted, origin: "null" },
    { ...trusted, "sec-fetch-site": "cross-site" },
    { ...trusted, "sec-fetch-site": "same-site" },
    { host: `attacker.example:${port}` },
    { host: `127.0.0.1:${port}.attacker.example` },
    {},
  ]) {
    assert.equal(isTrustedBridgeRequest({ headers }, port), false);
  }
});

test("account snapshots, active auth, and backups remain private", async () => {
  await withTempHome(async (home) => {
    const service = createAccountService({ home });
    const paths = service.paths;
    await fs.mkdir(paths.CODEX_DIR, { recursive: true, mode: 0o755 });
    await fs.writeFile(paths.AUTH_PATH, auth("work@example.com"), { mode: 0o644 });
    assert.equal((await service.handle({ action: "save", name: "work" })).ok, true);
    const permissions = async (file) => (await fs.stat(file)).mode & 0o777;
    assert.equal(await permissions(paths.CODEX_DIR), 0o700);
    assert.equal(await permissions(paths.ACCOUNTS_DIR), 0o700);
    assert.equal(await permissions(paths.AUTH_PATH), 0o600);
    assert.equal(await permissions(path.join(paths.ACCOUNTS_DIR, "work.json")), 0o600);
    await service.handle({ action: "switch", name: "work", relaunch: false });
    assert.equal(await permissions(paths.AUTH_PATH), 0o600);
    await service.handle({ action: "clear-active", relaunch: false });
    const backup = (await fs.readdir(paths.CODEX_DIR)).find((name) => name.startsWith("auth.account-switcher-backup-"));
    assert.equal(await permissions(path.join(paths.CODEX_DIR, backup)), 0o600);
  });
});

test("saving auth replaces destination symlinks without overwriting their target", async () => {
  await withTempHome(async (home) => {
    const service = createAccountService({ home });
    await fs.mkdir(service.paths.ACCOUNTS_DIR, { recursive: true });
    await fs.writeFile(service.paths.AUTH_PATH, auth("work@example.com"));
    const unrelated = path.join(home, "unrelated.txt");
    await fs.writeFile(unrelated, "preserve me");
    const snapshot = path.join(service.paths.ACCOUNTS_DIR, "work.json");
    await fs.symlink(unrelated, snapshot);
    assert.equal((await service.handle({ action: "save", name: "work" })).ok, true);
    assert.equal(await fs.readFile(unrelated, "utf8"), "preserve me");
    assert.equal((await fs.lstat(snapshot)).isSymbolicLink(), false);
  });
});

test("CDP account commands only run in the trusted main frame", async () => {
  const calls = [];
  const socket = { addEventListener() {}, close() {} };
  const session = new CdpSession(socket, { handle: async (message) => { calls.push(message); return { ok: true }; } }, () => {});
  session.send = async () => ({});
  session.setMainFrame({ id: "main", url: "app://-/index.html" });
  const emit = (message) => session.handleMessage({ data: JSON.stringify(message) });
  for (const [id, frameId, isDefault] of [[1, "main", true], [2, "iframe", true], [3, "main", false]]) {
    await emit({ method: "Runtime.executionContextCreated", params: { context: { id, auxData: { frameId, isDefault } } } });
  }
  const invoke = (executionContextId) => emit({ method: "Runtime.bindingCalled", params: {
    name: "__codexAccountSwitcherBridge", executionContextId,
    payload: JSON.stringify({ id: "1", message: { action: "state" } }),
  } });
  for (const id of [2, 3, 99]) await invoke(id);
  assert.equal(calls.length, 0);
  await invoke(1);
  assert.equal(calls.length, 1);
  await emit({ method: "Runtime.executionContextDestroyed", params: { executionContextId: 1 } });
  await invoke(1);
  assert.equal(calls.length, 1);
  session.setMainFrame({ id: "main", url: "https://attacker.example" });
  assert.equal(session.mainFrameId, null);
});

test("CDP injection rejects app page paths that only share a filename prefix", () => {
  const pages = codexPageTargets([
    { id: "real", type: "page", url: "app://-/index.html?initialRoute=%2Fsettings", webSocketDebuggerUrl: "ws://local" },
    { id: "bad", type: "page", url: "app://-/index.html.attacker", webSocketDebuggerUrl: "ws://local" },
  ]);
  assert.deepEqual(pages.map((page) => page.id), ["real"]);
});

test("sign-in URLs reject lookalike domains, embedded credentials, and HTTP", () => {
  for (const url of [
    "https://auth.openai.com.attacker.example/oauth/authorize",
    "https://attacker.example/oauth/authorize",
    "https://user:pass@auth.openai.com/oauth/authorize",
    "https://auth.openai.com:8080/oauth/authorize",
    "http://auth.openai.com/oauth/authorize",
  ]) {
    assert.throws(() => accountChooserURL(url), /Only official OpenAI HTTPS/);
  }
});
