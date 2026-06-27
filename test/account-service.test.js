"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { auth, withTempHome } = require("./support/fixtures");
const {
  accountChooserURL,
  createAccountService,
  openAccountChooserURL,
} = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");

test("account service saves, switches, deletes, and reports state", async () => {
  await withTempHome(async (home) => {
    const service = createAccountService({ home });
    const codexDir = path.join(home, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "auth.json"), auth("work@example.com", "work"));

    let result = await service.handle({ action: "save", name: "work" });
    assert.equal(result.ok, true);
    assert.equal(result.state.current, "work");

    await fs.writeFile(path.join(codexDir, "auth.json"), auth("me@example.com", "personal"));
    result = await service.handle({ action: "state" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accounts, ["account", "work"]);

    result = await service.handle({ action: "switch", name: "work" });
    assert.equal(result.ok, true);
    assert.equal(result.state.requiresAppRelaunch, true);
    assert.match(await fs.readFile(path.join(codexDir, "auth.json"), "utf8"), /work@example.com/);

    result = await service.handle({ action: "delete", name: "work" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accounts, ["account"]);
  });
});

test("account service switch requests a real Codex restart by default", async () => {
  await withTempHome(async (home) => {
    const relaunches = [];
    const service = createAccountService({ home, relaunch: (options) => { relaunches.push(options); } });
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });
    await fs.writeFile(path.join(accountsDir, "work.json"), auth("work@example.com", "work"));

    const result = await service.handle({ action: "switch", name: "work" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(result.ok, true);
    assert.equal(result.state.requiresAppRelaunch, true);
    assert.deepEqual(relaunches, [{ forceRelaunch: true }]);
  });
});

test("account service starts a new login by preserving the active account first", async () => {
  await withTempHome(async (home) => {
    const service = createAccountService({ home });
    const codexDir = path.join(home, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "auth.json"), auth("first@example.com", "first"));

    const result = await service.handle({ action: "start-login" });

    assert.equal(result.ok, true);
    assert.equal(result.state.hasActiveAuth, false);
    assert.deepEqual(result.state.accounts, ["account"]);
    assert.equal(result.state.accountEmails.account, "first@example.com");
    await assert.rejects(() => fs.access(path.join(codexDir, "auth.json")));
    assert.match(await fs.readFile(path.join(codexDir, "auth_accounts", "account.json"), "utf8"), /first@example.com/);
  });
});

test("account login URL forces fresh auth without unsupported prompt values", () => {
  const rawUrl = "https://auth.openai.com/oauth/authorize?client_id=codex&prompt=none&state=abc";

  const url = new URL(accountChooserURL(rawUrl));

  assert.equal(url.origin, "https://auth.openai.com");
  assert.equal(url.searchParams.get("client_id"), "codex");
  assert.equal(url.searchParams.get("state"), "abc");
  assert.equal(url.searchParams.has("prompt"), false);
  assert.equal(url.searchParams.get("max_age"), "0");
});

test("account service opens Codex login URLs in fresh auth mode", async () => {
  await withTempHome(async (home) => {
    const opened = [];
    const service = createAccountService({
      home,
      openURL: async (url) => {
        opened.push(url);
      },
    });

    const result = await service.handle({
      action: "open-url",
      url: "https://auth.openai.com/oauth/authorize?client_id=codex",
    });

    assert.equal(result.ok, true);
    assert.equal(opened.length, 1);
    const openedUrl = new URL(opened[0]);
    assert.equal(openedUrl.searchParams.has("prompt"), false);
    assert.equal(openedUrl.searchParams.get("max_age"), "0");
    assert.equal(result.openedUrl, opened[0]);
  });
});

test("account chooser opener rejects non-http login URLs", async () => {
  await assert.rejects(
    () => openAccountChooserURL("file:///tmp/auth.json", async () => {}),
    /Only http\(s\) login URLs are supported/,
  );
});

test("helper status emits JSON error for missing Codex app", () => {
  const cli = path.join(__dirname, "..", "Sources", "CodexAccountSwitcher", "Resources", "cdp-helper", "cli.js");
  const result = spawnSync(process.execPath, [
    cli,
    "status",
    "--codex-app",
    path.join(os.tmpdir(), "does-not-exist-Codex.app"),
    "--user-root",
    os.tmpdir(),
    "--json",
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error.message, /Codex\.app not found/);
});
