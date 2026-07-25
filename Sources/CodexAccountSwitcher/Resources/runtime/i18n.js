"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { INHERIT_LOCALE, resolveLocale } = require("./locale-catalog");

const messagesPath = path.join(__dirname, "..", "locales", "messages.json");

let cachedMessages = null;

function loadMessages() {
  if (!cachedMessages) {
    cachedMessages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
  }
  return cachedMessages;
}

function lookupMessage(catalog, locale, key) {
  const direct = catalog[locale]?.[key];
  if (direct != null) return direct;

  const inherited = INHERIT_LOCALE[locale];
  if (inherited) {
    const inheritedMessage = catalog[inherited]?.[key];
    if (inheritedMessage != null) return inheritedMessage;
  }

  const english = catalog.en?.[key];
  if (english != null) return english;

  return key;
}

function translate(key, locale, messages) {
  const catalog = messages || loadMessages();
  const resolved = resolveLocale(locale);
  return lookupMessage(catalog, resolved, key);
}

function createTranslator(messages) {
  const catalog = messages || loadMessages();
  return (key, locale) => translate(key, locale, catalog);
}

module.exports = {
  createTranslator,
  loadMessages,
  resolveLocale,
  translate,
};
