"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { accountPath, normalizeAccountName, pathExists } = require("./account-paths");
const { emailFromAuthString } = require("./auth-email");

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
  await ensurePrivateStorage(paths);
  await fsp.chmod(paths.AUTH_PATH, 0o600);
  await copyPrivateAuth(paths.AUTH_PATH, accountPath(paths, name));
  await fsp.writeFile(paths.CURRENT_NAME_PATH, `${name}\n`, "utf8");
  return readState(paths);
}

async function switchAccount(paths, rawName) {
  const name = normalizeAccountName(rawName);
  const source = accountPath(paths, name);
  if (!(await pathExists(source))) throw new Error(`Saved account not found: ${name}`);
  const authJson = await fsp.readFile(source, "utf8");
  await ensurePrivateStorage(paths);
  await writePrivateAuth(paths.AUTH_PATH, authJson);
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

async function clearActiveAuth(paths) {
  await ensurePrivateStorage(paths);
  if (await pathExists(paths.AUTH_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await copyPrivateAuth(paths.AUTH_PATH, path.join(paths.CODEX_DIR, `auth.account-switcher-backup-${stamp}.json`));
    await fsp.rm(paths.AUTH_PATH, { force: true });
  }
  await fsp.rm(paths.CURRENT_NAME_PATH, { force: true });
  return readState(paths, { autosave: false });
}

async function ensureAutosavedActiveAccount(paths) {
  if (!(await pathExists(paths.AUTH_PATH))) return null;
  await ensurePrivateStorage(paths);
  await fsp.chmod(paths.AUTH_PATH, 0o600);
  const accounts = await listAccountNames(paths);
  const matched = await findMatchingAccountByContents(paths, accounts);
  if (matched) {
    await fsp.writeFile(paths.CURRENT_NAME_PATH, `${matched}\n`, "utf8");
    return matched;
  }

  const active = await fsp.readFile(paths.AUTH_PATH, "utf8");
  const sameEmail = await findMatchingAccountByEmail(paths, accounts, active);
  if (sameEmail) {
    await copyPrivateAuth(paths.AUTH_PATH, accountPath(paths, sameEmail));
    await fsp.writeFile(paths.CURRENT_NAME_PATH, `${sameEmail}\n`, "utf8");
    return sameEmail;
  }

  const name = await nextAvailableAccountName(paths, "account");
  await copyPrivateAuth(paths.AUTH_PATH, accountPath(paths, name));
  await fsp.writeFile(paths.CURRENT_NAME_PATH, `${name}\n`, "utf8");
  return name;
}

async function ensurePrivateStorage(paths) {
  for (const directory of [paths.CODEX_DIR, paths.ACCOUNTS_DIR]) {
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsp.chmod(directory, 0o700);
  }
}

async function copyPrivateAuth(source, destination) {
  await writePrivateAuth(destination, await fsp.readFile(source));
}

async function writePrivateAuth(destination, contents) {
  const temporary = path.join(path.dirname(destination), `.account-switcher-${randomUUID()}.tmp`);
  try {
    await fsp.writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await fsp.rename(temporary, destination);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
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

module.exports = {
  clearActiveAuth,
  readState,
  saveCurrentAccount,
  startNewLogin,
  switchAccount,
  deleteAccount,
};
