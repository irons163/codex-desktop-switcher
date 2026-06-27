"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { withTempHome, writeAsarHeaderFixture } = require("./support/fixtures");
const {
  createAccountService,
  findCodexAssetByPrefix,
} = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");

test("account service finds Codex lazy asset chunks from the app asar header", async () => {
  await withTempHome(async (home) => {
    const codexApp = path.join(home, "Codex.app");
    const resources = path.join(codexApp, "Contents", "Resources");
    await fs.mkdir(resources, { recursive: true });
    await writeAsarHeaderFixture(path.join(resources, "app.asar"), {
      files: {
        webview: {
          files: {
            assets: {
              files: {
                "index-abc.js": { size: 0, offset: "0" },
                "onboarding-login-content-Bf2QVA6e.js": { size: 0, offset: "0" },
              },
            },
          },
        },
      },
    });

    const asset = await findCodexAssetByPrefix(codexApp, "onboarding-login-content-");
    assert.equal(asset.fileName, "onboarding-login-content-Bf2QVA6e.js");

    const service = createAccountService({ home, codexApp });
    const result = await service.handle({
      action: "find-codex-asset",
      prefix: "onboarding-login-content-",
    });
    assert.equal(result.ok, true);
    assert.equal(result.asset.fileName, "onboarding-login-content-Bf2QVA6e.js");
  });
});

test("asar asset lookup rejects unsafe prefixes", async () => {
  await assert.rejects(
    () => findCodexAssetByPrefix("/Applications/Codex.app", "../secret"),
    /Asset prefix is required/,
  );
});

test("asar asset lookup reports an invalid header size", async () => {
  await withTempHome(async (home) => {
    const codexApp = path.join(home, "Codex.app");
    const asarPath = path.join(codexApp, "Contents", "Resources", "app.asar");
    await fs.mkdir(path.dirname(asarPath), { recursive: true });
    await fs.writeFile(asarPath, Buffer.alloc(16));

    await assert.rejects(
      () => findCodexAssetByPrefix(codexApp, "index-"),
      /Invalid asar header size/,
    );
  });
});
