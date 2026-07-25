"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { withTempHome } = require("./support/fixtures");
const { readPreferences, resolveLanguage, writePreferences } = require("../Sources/CodexAccountSwitcher/Resources/runtime/preferences");

test("preferences resolve auto language from navigator locale", () => {
  assert.equal(resolveLanguage({ language: "auto" }, "zh-TW"), "zh-TW");
  assert.equal(resolveLanguage({ language: "auto" }, "en-US"), "en");
  assert.equal(resolveLanguage({ language: "en" }, "zh-TW"), "en");
});

test("preferences persist to user root", async () => {
  await withTempHome(async (home) => {
    const userRoot = path.join(home, "switcher");
    const saved = await writePreferences(userRoot, { language: "zh-TW" });
    assert.equal(saved.language, "zh-TW");
    assert.deepEqual(await readPreferences(userRoot), { language: "zh-TW" });
  });
});
