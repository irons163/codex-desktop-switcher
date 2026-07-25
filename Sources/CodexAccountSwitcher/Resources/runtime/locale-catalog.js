"use strict";

const CODEX_LOCALES = [
  "am",
  "ar",
  "bg-BG",
  "bn-BD",
  "bs-BA",
  "ca-ES",
  "cs-CZ",
  "da-DK",
  "de-DE",
  "el-GR",
  "es-419",
  "es-ES",
  "et-EE",
  "fa",
  "fi-FI",
  "fr-CA",
  "fr-FR",
  "gu-IN",
  "hi-IN",
  "hr-HR",
  "hu-HU",
  "hy-AM",
  "id-ID",
  "is-IS",
  "it-IT",
  "ja-JP",
  "ka-GE",
  "kk",
  "kn-IN",
  "ko-KR",
  "lt",
  "lv-LV",
  "mk-MK",
  "ml",
  "mn",
  "mr-IN",
  "ms-MY",
  "my-MM",
  "nb-NO",
  "nl-NL",
  "pa",
  "pl-PL",
  "pt-BR",
  "pt-PT",
  "ro-RO",
  "ru-RU",
  "sk-SK",
  "sl-SI",
  "so-SO",
  "sq-AL",
  "sr-RS",
  "sv-SE",
  "sw-TZ",
  "ta-IN",
  "te-IN",
  "th-TH",
  "tl",
  "tr-TR",
  "uk-UA",
  "ur",
  "vi-VN",
  "zh-CN",
  "zh-HK",
  "zh-TW",
];

const APP_LOCALE = "en";

const SUPPORTED_LOCALES = ["auto", APP_LOCALE, ...CODEX_LOCALES];

const LEGACY_LOCALE_TAGS = {
  "zh-Hant": "zh-TW",
  "zh-Hans": "zh-CN",
  no: "nb-NO",
  "no-NO": "nb-NO",
  nb: "nb-NO",
};

const INHERIT_LOCALE = {
  "zh-HK": "zh-TW",
  "es-419": "es-ES",
  "fr-CA": "fr-FR",
  "pt-PT": "pt-BR",
  "nb-NO": "da-DK",
};

const CODEX_LOCALE_SET = new Set(CODEX_LOCALES);

function normalizeLocaleTag(tag) {
  if (!tag || typeof tag !== "string") return "";
  const trimmed = tag.trim();
  if (!trimmed) return "";
  if (LEGACY_LOCALE_TAGS[trimmed]) return LEGACY_LOCALE_TAGS[trimmed];

  const parts = trimmed.split("-").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].toLowerCase();

  const [language, ...rest] = parts;
  const normalizedRest = rest.map((part) => {
    if (part.length === 2) return part.toUpperCase();
    if (part.length === 4) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
    return part;
  });

  const candidate = [language.toLowerCase(), ...normalizedRest].join("-");
  return LEGACY_LOCALE_TAGS[candidate] || candidate;
}

function findLocaleByLanguagePrefix(language) {
  const lang = String(language || "").toLowerCase();
  if (!lang) return null;
  if (lang === APP_LOCALE) return APP_LOCALE;
  if (CODEX_LOCALE_SET.has(lang)) return lang;

  const regional = CODEX_LOCALES.find((locale) => locale.toLowerCase().startsWith(`${lang}-`));
  return regional || null;
}

function resolveLocaleTag(tag) {
  const normalized = normalizeLocaleTag(tag);
  if (!normalized) return APP_LOCALE;

  if (normalized === APP_LOCALE || CODEX_LOCALE_SET.has(normalized)) {
    return normalized;
  }

  const inherited = INHERIT_LOCALE[normalized];
  if (inherited && (inherited === APP_LOCALE || CODEX_LOCALE_SET.has(inherited))) {
    return inherited;
  }

  const prefixMatch = findLocaleByLanguagePrefix(normalized.split("-")[0]);
  if (prefixMatch) return prefixMatch;

  return APP_LOCALE;
}

function resolveLocale(preference, navigatorLanguage = "") {
  if (!preference || preference === "auto") {
    return resolveLocaleTag(navigatorLanguage || APP_LOCALE);
  }
  return resolveLocaleTag(preference);
}

module.exports = {
  APP_LOCALE,
  CODEX_LOCALES,
  INHERIT_LOCALE,
  LEGACY_LOCALE_TAGS,
  SUPPORTED_LOCALES,
  normalizeLocaleTag,
  resolveLocale,
};
