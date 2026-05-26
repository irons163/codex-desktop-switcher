"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const childProcess = require("node:child_process");

const ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

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

function codexAuthPaths(home) {
  const CODEX_DIR = path.join(home, ".codex");
  return {
    CODEX_DIR,
    AUTH_PATH: path.join(CODEX_DIR, "auth.json"),
    ACCOUNTS_DIR: path.join(CODEX_DIR, "auth_accounts"),
    USAGE_CACHE_PATH: path.join(CODEX_DIR, "auth_accounts_usage.json"),
    CURRENT_NAME_PATH: path.join(CODEX_DIR, "current_account"),
  };
}

async function readState(paths, { autosave = true } = {}) {
  if (autosave) await ensureAutosavedActiveAccount(paths);
  const allAccounts = await listAccountNames(paths);
  const visibleAccounts = await selectVisibleAccounts(paths, allAccounts);
  const accounts = visibleAccounts.map((account) => account.name);
  const current = await getCurrentAccountName(paths, accounts);
  const accountEmails = Object.fromEntries(
    visibleAccounts.map(({ name, email }) => [name, email]).filter(([, email]) => email),
  );
  const accountUsage = await readAccountUsage(paths, accounts);
  return {
    accounts,
    accountEmails,
    accountUsage,
    current,
    hasActiveAuth: await pathExists(paths.AUTH_PATH),
    paths: {
      auth: paths.AUTH_PATH,
      accountsDir: paths.ACCOUNTS_DIR,
      current: paths.CURRENT_NAME_PATH,
    },
  };
}

async function saveCurrentAccount(paths, rawName) {
  const name = normalizeAccountName(rawName);
  if (!(await pathExists(paths.AUTH_PATH))) {
    throw new Error(`No active Codex auth file found at ${paths.AUTH_PATH}`);
  }
  await fsp.mkdir(paths.ACCOUNTS_DIR, { recursive: true });
  await fsp.copyFile(paths.AUTH_PATH, accountPath(paths, name));
  await fsp.writeFile(paths.CURRENT_NAME_PATH, `${name}\n`, "utf8");
  return readState(paths);
}

async function switchAccount(paths, rawName) {
  const name = normalizeAccountName(rawName);
  const source = accountPath(paths, name);
  if (!(await pathExists(source))) throw new Error(`Saved account not found: ${name}`);
  const authJson = await fsp.readFile(source, "utf8");
  await fsp.mkdir(paths.CODEX_DIR, { recursive: true });
  await fsp.writeFile(paths.AUTH_PATH, authJson, "utf8");
  await fsp.writeFile(paths.CURRENT_NAME_PATH, `${name}\n`, "utf8");
  return readState(paths);
}

async function deleteAccount(paths, rawName) {
  const name = normalizeAccountName(rawName);
  await fsp.rm(accountPath(paths, name), { force: true });
  try {
    const current = (await fsp.readFile(paths.CURRENT_NAME_PATH, "utf8")).trim();
    if (current === name) await fsp.rm(paths.CURRENT_NAME_PATH, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return readState(paths, { autosave: false });
}

async function startNewLogin(paths) {
  await ensureAutosavedActiveAccount(paths);
  return clearActiveAuth(paths);
}

function accountChooserURL(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) throw new Error("Login URL is required.");
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) login URLs are supported.");
  }
  url.searchParams.delete("prompt");
  url.searchParams.set("max_age", "0");
  return url.toString();
}

async function openAccountChooserURL(rawUrl, opener = openExternalURL) {
  const url = accountChooserURL(rawUrl);
  await opener(url);
  return url;
}

function openExternalURL(url) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("open", [url], { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function clearActiveAuth(paths) {
  await fsp.mkdir(paths.CODEX_DIR, { recursive: true });
  if (await pathExists(paths.AUTH_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fsp.copyFile(paths.AUTH_PATH, path.join(paths.CODEX_DIR, `auth.account-switcher-backup-${stamp}.json`));
    await fsp.rm(paths.AUTH_PATH, { force: true });
  }
  await fsp.rm(paths.CURRENT_NAME_PATH, { force: true });
  return readState(paths, { autosave: false });
}

async function ensureAutosavedActiveAccount(paths) {
  if (!(await pathExists(paths.AUTH_PATH))) return null;
  const accounts = await listAccountNames(paths);
  const matched = await findMatchingAccountByContents(paths, accounts);
  if (matched) {
    await fsp.writeFile(paths.CURRENT_NAME_PATH, `${matched}\n`, "utf8");
    return matched;
  }

  const active = await fsp.readFile(paths.AUTH_PATH, "utf8");
  const sameEmail = await findMatchingAccountByEmail(paths, accounts, active);
  if (sameEmail) {
    await fsp.copyFile(paths.AUTH_PATH, accountPath(paths, sameEmail));
    await fsp.writeFile(paths.CURRENT_NAME_PATH, `${sameEmail}\n`, "utf8");
    return sameEmail;
  }

  await fsp.mkdir(paths.ACCOUNTS_DIR, { recursive: true });
  const name = await nextAvailableAccountName(paths, "account");
  await fsp.copyFile(paths.AUTH_PATH, accountPath(paths, name));
  await fsp.writeFile(paths.CURRENT_NAME_PATH, `${name}\n`, "utf8");
  return name;
}

async function listAccountNames(paths) {
  if (!(await pathExists(paths.ACCOUNTS_DIR))) return [];
  const entries = await fsp.readdir(paths.ACCOUNTS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/i, ""))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

async function getCurrentAccountName(paths, accounts) {
  if (!(await pathExists(paths.AUTH_PATH))) return null;
  const matched = await findMatchingAccountByContents(paths, accounts);
  if (matched) return matched;
  try {
    const name = (await fsp.readFile(paths.CURRENT_NAME_PATH, "utf8")).trim();
    if (name && accounts.includes(name)) return name;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}

async function findMatchingAccountByContents(paths, accounts) {
  let active;
  try {
    active = await fsp.readFile(paths.AUTH_PATH, "utf8");
  } catch {
    return null;
  }
  for (const name of accounts) {
    try {
      if ((await fsp.readFile(accountPath(paths, name), "utf8")) === active) return name;
    } catch {}
  }
  return null;
}

async function findMatchingAccountByEmail(paths, accounts, activeContents) {
  const activeEmail = emailFromAuthString(activeContents)?.toLowerCase();
  if (!activeEmail) return null;
  let current = null;
  try {
    current = (await fsp.readFile(paths.CURRENT_NAME_PATH, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const matches = [];
  for (const name of accounts) {
    try {
      const filePath = accountPath(paths, name);
      const [contents, stat] = await Promise.all([fsp.readFile(filePath, "utf8"), fsp.stat(filePath)]);
      if (emailFromAuthString(contents)?.toLowerCase() === activeEmail) {
        matches.push({ name, isCurrent: name === current, mtimeMs: stat.mtimeMs });
      }
    } catch {}
  }
  matches.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return matches[0]?.name || null;
}

async function selectVisibleAccounts(paths, accounts) {
  const details = await Promise.all(accounts.map((name) => readAccountDetails(paths, name)));
  const byIdentity = new Map();
  for (const detail of details) {
    const key = detail.email ? `email:${detail.email.toLowerCase()}` : `name:${detail.name}`;
    const existing = byIdentity.get(key);
    if (!existing || compareAccountPreference(detail, existing) < 0) byIdentity.set(key, detail);
  }
  return Array.from(byIdentity.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

async function readAccountDetails(paths, name) {
  let raw = null;
  let mtimeMs = 0;
  try {
    const filePath = accountPath(paths, name);
    const [contents, stat] = await Promise.all([fsp.readFile(filePath, "utf8"), fsp.stat(filePath)]);
    raw = contents;
    mtimeMs = stat.mtimeMs;
  } catch {}
  return {
    name,
    email: raw ? emailFromAuthString(raw) : null,
    isActive: raw ? await accountContentsMatchActive(paths, raw) : false,
    mtimeMs,
  };
}

function compareAccountPreference(left, right) {
  if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
  if (left.mtimeMs !== right.mtimeMs) return right.mtimeMs - left.mtimeMs;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

async function accountContentsMatchActive(paths, contents) {
  try {
    return (await fsp.readFile(paths.AUTH_PATH, "utf8")) === contents;
  } catch {
    return false;
  }
}

async function nextAvailableAccountName(paths, baseName) {
  const accounts = new Set(await listAccountNames(paths));
  if (!accounts.has(baseName)) return baseName;
  for (let index = 2; index < 10000; index += 1) {
    const name = `${baseName}-${index}`;
    if (!accounts.has(name)) return name;
  }
  throw new Error("Could not find an available account name.");
}

async function readAccountUsage(paths, accounts) {
  let raw;
  try {
    raw = JSON.parse(await fsp.readFile(paths.USAGE_CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(accounts.map((name) => [name, raw[name]]).filter(([, usage]) => usage));
}

async function findCodexAssetByPrefix(codexApp, rawPrefix) {
  if (typeof rawPrefix !== "string" || !/^[a-zA-Z0-9._-]+$/.test(rawPrefix)) {
    throw new Error("Asset prefix is required.");
  }
  const asarPath = path.join(codexApp, "Contents", "Resources", "app.asar");
  const header = await readAsarHeader(asarPath);
  const files = collectAsarFiles(header);
  const match = files.find((file) => {
    const fileName = path.posix.basename(file);
    return /\/(?:webview\/)?assets\//.test(file)
      && fileName.startsWith(rawPrefix)
      && fileName.endsWith(".js");
  });
  if (!match) throw new Error(`Codex asset not found: ${rawPrefix}`);
  return {
    path: match,
    fileName: path.posix.basename(match),
  };
}

async function readAsarHeader(asarPath) {
  const handle = await fsp.open(asarPath, "r");
  try {
    const prefix = Buffer.alloc(16);
    await handle.read(prefix, 0, prefix.length, 0);
    const jsonSize = prefix.readUInt32LE(12);
    if (!Number.isFinite(jsonSize) || jsonSize <= 0 || jsonSize > 64 * 1024 * 1024) {
      throw new Error(`Invalid asar header size in ${asarPath}`);
    }
    const json = Buffer.alloc(jsonSize);
    await handle.read(json, 0, jsonSize, 16);
    return JSON.parse(json.toString("utf8"));
  } finally {
    await handle.close();
  }
}

function collectAsarFiles(header) {
  const output = [];
  collectAsarNode(header, "", output);
  return output;
}

function collectAsarNode(node, prefix, output) {
  const files = node?.files;
  if (!files || typeof files !== "object") return;
  for (const [name, child] of Object.entries(files)) {
    const next = `${prefix}/${name}`;
    if (child?.files) collectAsarNode(child, next, output);
    else output.push(next);
  }
}

function normalizeAccountName(rawName) {
  if (typeof rawName !== "string") throw new Error("Account name is required.");
  const name = rawName.trim().replace(/\.json$/i, "");
  if (!ACCOUNT_NAME_PATTERN.test(name)) {
    throw new Error("Use letters, numbers, dots, underscores, or dashes. The name must start with a letter or number.");
  }
  return name;
}

function accountPath(paths, name) {
  return path.join(paths.ACCOUNTS_DIR, `${name}.json`);
}

async function pathExists(target) {
  try {
    await fsp.access(target, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function emailFromAuthString(raw) {
  try {
    return emailFromAuth(JSON.parse(raw));
  } catch {
    return null;
  }
}

function emailFromAuth(auth) {
  const direct = auth?.email || auth?.user?.email || auth?.account?.email;
  if (typeof direct === "string" && direct.includes("@")) return direct;
  const idToken = auth?.tokens?.id_token;
  const claims = jwtPayload(idToken);
  const nestedEmail = claims?.["https://api.openai.com/profile"]?.email;
  if (typeof nestedEmail === "string" && nestedEmail.includes("@")) return nestedEmail;
  return typeof claims?.email === "string" && claims.email.includes("@") ? claims.email : null;
}

function jwtPayload(token) {
  if (typeof token !== "string") return null;
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
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
