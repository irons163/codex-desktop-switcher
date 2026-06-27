"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

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

function normalizeAccountName(rawName) {
  if (typeof rawName !== "string") throw new Error("Account name is required.");
  const name = rawName.trim().replace(/\.json$/i, "");
  if (!ACCOUNT_NAME_PATTERN.test(name)) {
    throw new Error("Use letters, numbers, dots, underscores, or dashes. The name must start with a letter or number.");
  }
  return name;
}

module.exports = { accountPath, codexAuthPaths, normalizeAccountName, pathExists };
