"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const {
  CODEX_LOCALES,
  SUPPORTED_LOCALES,
  normalizeLocaleTag,
  resolveLocale,
} = require("../Sources/CodexAccountSwitcher/Resources/runtime/locale-catalog");
const { loadMessages, translate } = require("../Sources/CodexAccountSwitcher/Resources/runtime/i18n");
const { migratePreference, resolveLanguage } = require("../Sources/CodexAccountSwitcher/Resources/runtime/preferences");

test("locale catalog matches Codex desktop locale list", () => {
  assert.equal(CODEX_LOCALES.length, 64);
  assert.equal(SUPPORTED_LOCALES.length, 66);
  assert.ok(SUPPORTED_LOCALES.includes("auto"));
  assert.ok(SUPPORTED_LOCALES.includes("en"));
});

test("locale resolver normalizes legacy tags and auto mode", () => {
  assert.equal(normalizeLocaleTag("zh-Hant"), "zh-TW");
  assert.equal(resolveLocale("auto", "ja-JP"), "ja-JP");
  assert.equal(resolveLocale("zh-Hant", "en-US"), "zh-TW");
  assert.equal(resolveLocale("fr-CA", "en-US"), "fr-CA");
});

test("preferences migrate legacy zh-Hant preference", () => {
  assert.equal(migratePreference("zh-Hant"), "zh-TW");
  assert.equal(resolveLanguage({ language: "zh-Hant" }, "en-US"), "zh-TW");
});

test("messages catalog includes every Codex locale", () => {
  const messages = loadMessages();
  const keys = Object.keys(messages.en || {});
  assert.ok(keys.length >= 45);
  for (const locale of ["en", ...CODEX_LOCALES]) {
    assert.ok(messages[locale], `missing locale ${locale}`);
    for (const key of keys) {
      assert.ok(messages[locale][key], `missing ${locale}.${key}`);
    }
  }
  assert.equal(translate("appTitle", "ja-JP", messages), messages["ja-JP"].appTitle);
});
