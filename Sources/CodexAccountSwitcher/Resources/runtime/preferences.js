"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { resolveLocale } = require("./locale-catalog");

const DEFAULTS = { language: "auto" };

function preferencesPath(userRoot) {
  return path.join(userRoot, "preferences.json");
}

async function readPreferences(userRoot) {
  try {
    const raw = await fsp.readFile(preferencesPath(userRoot), "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed, language: migratePreference(parsed.language) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function writePreferences(userRoot, patch) {
  await fsp.mkdir(userRoot, { recursive: true });
  const current = await readPreferences(userRoot);
  const next = { ...current, ...patch };
  if (patch.language) next.language = migratePreference(patch.language);
  await fsp.writeFile(preferencesPath(userRoot), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function migratePreference(raw) {
  if (!raw || raw === "auto") return "auto";
  if (raw === "zhHant" || raw === "zh-Hant") return "zh-TW";
  return raw;
}

function resolveLanguage(preferences, navigatorLanguage = "") {
  return resolveLocale(preferences?.language || "auto", navigatorLanguage);
}

module.exports = { migratePreference, readPreferences, resolveLanguage, writePreferences };
