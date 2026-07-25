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

  assert.match(source, /action: "start-login"/);
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

test("renderer starts Codex native ChatGPT login after preparing a new account", () => {
  const source = rendererInjectionSource();

  assert.match(source, /chatgpt-desktop-auth-url-/);
  assert.match(source, /onboarding-login-content-/);
  assert.match(source, /login-with-chatgpt/);
  assert.match(source, /find-codex-asset/);
  assert.match(source, /import\(/);
  assert.match(source, /authUrl/);
  assert.match(source, /action: "open-url"/);
  assert.match(source, /AbortController/);
  assert.match(source, /useStreamlinedLogin:\s*false/);
  assert.match(source, /relaunch:\s*false/);
});

test("renderer switch uses a real Codex relaunch because hot auth refresh is not reliable", () => {
  const source = rendererInjectionSource();

  assert.match(source, /action: "switch", name, relaunch: true/);
  assert.doesNotMatch(source, /account\/login\/start/);
  assert.doesNotMatch(source, /chatgptAuthTokens/);
  assert.doesNotMatch(source, /softRefresh:\s*true/);
});

test("renderer gets a native login URL before clearing the active auth file", () => {
  const source = rendererInjectionSource();
  const loginIndex = source.indexOf("loginResult = await startLogin");
  const clearIndex = source.indexOf('action: "start-login"');

  assert.notEqual(loginIndex, -1);
  assert.notEqual(clearIndex, -1);
  assert.ok(loginIndex < clearIndex);
});

test("renderer asset discovery supports current and legacy Codex asset roots", () => {
  const source = rendererInjectionSource();

  assert.match(source, /webview/);
  assert.match(source, /\(\?:webview\\\/\)\?assets/);
});
