"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const test = require("node:test");
const { auth, workspaceAuth, withTempHome } = require("./support/fixtures");
const { createAccountService } = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");
const { codexAuthPaths, accountPath } = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-paths");
const { readState } = require("../Sources/CodexAccountSwitcher/Resources/runtime/auth-store");

test("personal and business workspaces for one email survive adding, switching, and token refresh", async () => {
  await withTempHome(async (home) => {
    const paths = codexAuthPaths(home);
    const service = createAccountService({ home });
    await fs.mkdir(paths.CODEX_DIR, { recursive: true });
    const personal = workspaceAuth("same@example.com", "personal-workspace", "plus");
    const business = workspaceAuth("same@example.com", "business-workspace", "team");
    await fs.writeFile(paths.AUTH_PATH, personal);
    await service.handle({ action: "save", name: "personal" });
    await fs.writeFile(paths.AUTH_PATH, business);

    let result = await service.handle({ action: "state" });
    assert.deepEqual(result.state.accounts, ["account", "personal"]);
    assert.equal(result.state.current, "account");
    assert.equal(await fs.readFile(accountPath(paths, "personal"), "utf8"), personal);
    assert.equal(await fs.readFile(accountPath(paths, "account"), "utf8"), business);
    assert.match(result.state.accountLabels.personal, /same@example\.com.*Plus/);
    assert.match(result.state.accountLabels.account, /same@example\.com.*Business/);

    result = await service.handle({ action: "switch", name: "personal", relaunch: false });
    assert.equal(result.ok, true);
    assert.equal(await fs.readFile(paths.AUTH_PATH, "utf8"), personal);
    const refreshed = workspaceAuth("SAME@example.com", "personal-workspace", "pro", "refreshed");
    await fs.writeFile(paths.AUTH_PATH, refreshed);
    result = await service.handle({ action: "state" });
    assert.deepEqual(result.state.accounts, ["account", "personal"]);
    assert.equal(result.state.current, "personal");
    assert.equal(await fs.readFile(accountPath(paths, "personal"), "utf8"), refreshed);
    assert.equal(await fs.readFile(accountPath(paths, "account"), "utf8"), business);
    assert.match(result.state.accountLabels.personal, /Pro/);
  });
});

test("multiple business workspaces and different users of a shared workspace stay separate", async () => {
  await withTempHome(async (home) => {
    const paths = codexAuthPaths(home);
    const service = createAccountService({ home });
    await fs.mkdir(paths.CODEX_DIR, { recursive: true });
    for (const [email, id] of [["same@example.com", "first-business"], ["same@example.com", "second-business"], ["other@example.com", "first-business"]]) {
      await fs.writeFile(paths.AUTH_PATH, workspaceAuth(email, id, "team"));
      assert.equal((await service.handle({ action: "state" })).ok, true);
    }
    const result = await service.handle({ action: "state" });
    assert.equal(result.state.accounts.length, 3);
    assert.equal(new Set(Object.values(result.state.accountLabels)).size, 3);
  });
});

test("known workspace credentials never replace a legacy snapshot with an unknown workspace", async () => {
  await withTempHome(async (home) => {
    const paths = codexAuthPaths(home);
    const service = createAccountService({ home });
    await fs.mkdir(paths.ACCOUNTS_DIR, { recursive: true });
    const legacy = auth("same@example.com");
    await fs.writeFile(accountPath(paths, "legacy"), legacy);
    await fs.writeFile(paths.AUTH_PATH, workspaceAuth("same@example.com", "business", "team"));
    const result = await service.handle({ action: "state" });
    assert.deepEqual(result.state.accounts, ["account", "legacy"]);
    assert.equal(await fs.readFile(accountPath(paths, "legacy"), "utf8"), legacy);
  });
});

test("manual save refuses to overwrite another workspace with the same snapshot name", async () => {
  await withTempHome(async (home) => {
    const paths = codexAuthPaths(home);
    const service = createAccountService({ home });
    await fs.mkdir(paths.CODEX_DIR, { recursive: true });
    const personal = workspaceAuth("same@example.com", "personal", "plus");
    const business = workspaceAuth("same@example.com", "business", "team");
    await fs.writeFile(paths.AUTH_PATH, personal);
    await service.handle({ action: "save", name: "saved" });
    await fs.writeFile(paths.AUTH_PATH, business);
    const result = await service.handle({ action: "save", name: "saved" });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /different account or workspace/i);
    assert.equal(await fs.readFile(accountPath(paths, "saved"), "utf8"), personal);
    assert.equal(await fs.readFile(paths.AUTH_PATH, "utf8"), business);
  });
});

test("deduplication merges refreshed credentials only within the same user and workspace", async () => {
  await withTempHome(async (home) => {
    const paths = codexAuthPaths(home);
    await fs.mkdir(paths.ACCOUNTS_DIR, { recursive: true });
    const personal = workspaceAuth("same@example.com", "personal", "plus");
    const business = workspaceAuth("same@example.com", "business", "team");
    await fs.writeFile(accountPath(paths, "personal"), personal);
    await fs.writeFile(accountPath(paths, "business-old"), business);
    const refreshed = workspaceAuth("same@example.com", "business", "team", "refreshed");
    await fs.writeFile(accountPath(paths, "business-current"), refreshed);
    await fs.writeFile(paths.AUTH_PATH, refreshed);
    const state = await readState(paths);
    assert.deepEqual(state.accounts, ["business-current", "personal"]);
    assert.equal(state.current, "business-current");
  });
});

test("a stale current marker cannot label another active workspace as current", async () => {
  await withTempHome(async (home) => {
    const paths = codexAuthPaths(home);
    await fs.mkdir(paths.ACCOUNTS_DIR, { recursive: true });
    await fs.writeFile(accountPath(paths, "personal"), workspaceAuth("same@example.com", "personal"));
    await fs.writeFile(paths.AUTH_PATH, workspaceAuth("same@example.com", "business", "team"));
    await fs.writeFile(paths.CURRENT_NAME_PATH, "personal\n");
    assert.equal((await readState(paths, { autosave: false })).current, null);
  });
});
