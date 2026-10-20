"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { rendererInjectionSource } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp");

test("renderer injection uses CDP binding bridge instead of Electron preload APIs", () => {
  const source = rendererInjectionSource();

  assert.match(source, /__codexAccountSwitcherBridge/);
  assert.match(source, /data-codex-account-switcher-panel/);
  assert.doesNotMatch(source, /ipcRenderer/);
  assert.doesNotMatch(source, /require\(["']electron["']\)/);
});

test("renderer injection supports cleanup before reinjection", () => {
  const source = rendererInjectionSource();

  assert.match(source, /__codexAccountSwitcherCleanup/);
  assert.match(source, /previous runtime cleanup failed/);
  assert.doesNotMatch(source, /if \\(window\\.__codexAccountSwitcherInstalled\\) return;/);
});

test("renderer injection adds an Accounts page to native Codex Settings", () => {
  const source = rendererInjectionSource();

  assert.match(source, /data-codex-account-switcher-settings-group/);
  assert.match(source, /findCodexSettingsSidebar/);
  assert.match(source, /Configuration/);
  assert.match(source, /Personalization/);
});

test("renderer new sign-in command starts the multi-account login flow", () => {
  const source = rendererInjectionSource();

  assert.match(source, /action: "new-sign-in"/);
  assert.match(source, /25000/);
});

test("renderer account popup exposes save and new sign-in actions directly", () => {
  const source = rendererInjectionSource();

  assert.match(source, /menuButton\(t\("save"\)/);
  assert.match(source, /menuButton\(t\("newSignIn"\)/);
  assert.match(source, /hasEmail/);
  assert.match(source, /hasSettings && hasLogout/);
  assert.match(source, /__codexAccountSwitcherMessages/);
  assert.match(source, /SUPPORTED_LOCALES/);
});

test("renderer account popup reports async action failures instead of swallowing them", () => {
  const source = rendererInjectionSource();

  assert.match(source, /Promise\.resolve\(action\(\)\)/);
  assert.match(source, /Account Switcher.*menu action failed/);
});

test("renderer delegates new sign-in to the local service without importing private desktop modules", () => {
  const source = rendererInjectionSource();

  assert.match(source, /action: "new-sign-in"/);
  assert.doesNotMatch(source, /chatgpt-desktop-auth-url-/);
  assert.doesNotMatch(source, /onboarding-login-content-/);
  assert.doesNotMatch(source, /import\(/);
});

test("renderer switch uses a real Codex relaunch because hot auth refresh is not reliable", () => {
  const source = rendererInjectionSource();

  assert.match(source, /action: "switch", name, relaunch: true/);
  assert.doesNotMatch(source, /account\/login\/start/);
  assert.doesNotMatch(source, /chatgptAuthTokens/);
  assert.doesNotMatch(source, /softRefresh:\s*true/);
});

test("renderer does not clear active auth during browser sign-in", () => {
  const source = rendererInjectionSource();
  assert.doesNotMatch(source, /action: "start-login"/);
  assert.doesNotMatch(source, /action: "clear-active"/);
});

test("renderer sign-in status remains attached to the panel on failure", () => {
  const source = rendererInjectionSource();

  assert.match(source, /panel\.appendChild\(status\)/);
  assert.match(source, /status\.setAttribute\("role", "alert"\)/);
  assert.match(source, /button\.disabled = false/);
});
