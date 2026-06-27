"use strict";

const os = require("node:os");
const { accountChooserURL, openAccountChooserURL, openExternalURL } = require("./login-url");
const { clearActiveAuth, readState, saveCurrentAccount, startNewLogin, switchAccount, deleteAccount } = require("./auth-store");
const { codexAuthPaths, normalizeAccountName } = require("./account-paths");
const { emailFromAuthString } = require("./auth-email");
const { collectAsarFiles, findCodexAssetByPrefix } = require("./asar-assets");

function createAccountService(options = {}) {
  const home = options.home || os.homedir();
  const relaunch = options.relaunch || (() => {});
  const openURL = options.openURL || openExternalURL;
  const codexApp = options.codexApp || "/Applications/Codex.app";
  const paths = codexAuthPaths(home);

  return {
    paths,
    async handle(message = {}) {
      try {
        const action = message.action;
        if (action === "state") return ok({ state: await readState(paths) });
        if (action === "save") return ok({ state: await saveCurrentAccount(paths, message.name) });
        if (action === "switch") {
          const shouldRelaunch = message.relaunch !== false;
          const state = await switchAccount(paths, message.name);
          if (shouldRelaunch) setTimeout(() => relaunch({ forceRelaunch: true }), 250);
          return ok({ state: { ...state, requiresAppRelaunch: shouldRelaunch } });
        }
        if (action === "delete") return ok({ state: await deleteAccount(paths, message.name) });
        if (action === "start-login") {
          const state = await startNewLogin(paths);
          if (message.relaunch !== false) setTimeout(() => relaunch({ clearBrowserSession: true }), 250);
          return ok({ state: { ...state, requiresAppRelaunch: true, requiresFreshLogin: true } });
        }
        if (action === "find-codex-asset") {
          return ok({ asset: await findCodexAssetByPrefix(codexApp, message.prefix) });
        }
        if (action === "open-url") {
          return ok({ openedUrl: await openAccountChooserURL(message.url, openURL) });
        }
        if (action === "clear-active") {
          const state = await clearActiveAuth(paths);
          if (message.relaunch !== false) setTimeout(relaunch, 250);
          return ok({ state: { ...state, requiresAppRelaunch: true } });
        }
        return fail(`Unknown account action: ${String(action)}`);
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  };
}

function ok(payload) {
  return { ok: true, ...payload };
}

function fail(message) {
  return { ok: false, error: { message: String(message) } };
}

function errorMessage(error) {
  return error && typeof error.message === "string" ? error.message : String(error);
}

module.exports = {
  accountChooserURL,
  collectAsarFiles,
  createAccountService,
  codexAuthPaths,
  findCodexAssetByPrefix,
  normalizeAccountName,
  emailFromAuthString,
  openAccountChooserURL,
};
