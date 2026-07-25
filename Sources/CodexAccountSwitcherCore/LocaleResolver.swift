import Foundation

public enum CodexLocaleCatalog {
    public static let appLocale = "en"
    public static let auto = "auto"

    public static let codexLocales: [String] = [
        "am", "ar", "bg-BG", "bn-BD", "bs-BA", "ca-ES", "cs-CZ", "da-DK", "de-DE", "el-GR",
        "es-419", "es-ES", "et-EE", "fa", "fi-FI", "fr-CA", "fr-FR", "gu-IN", "hi-IN", "hr-HR",
        "hu-HU", "hy-AM", "id-ID", "is-IS", "it-IT", "ja-JP", "ka-GE", "kk", "kn-IN", "ko-KR",
        "lt", "lv-LV", "mk-MK", "ml", "mn", "mr-IN", "ms-MY", "my-MM", "nb-NO", "nl-NL", "pa",
        "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU", "sk-SK", "sl-SI", "so-SO", "sq-AL", "sr-RS",
        "sv-SE", "sw-TZ", "ta-IN", "te-IN", "th-TH", "tl", "tr-TR", "uk-UA", "ur", "vi-VN",
        "zh-CN", "zh-HK", "zh-TW",
    ]

    public static let supportedLocales: [String] = [auto, appLocale] + codexLocales

    private static let legacyTags: [String: String] = [
        "zh-Hant": "zh-TW",
        "zh-Hans": "zh-CN",
        "no": "nb-NO",
        "no-NO": "nb-NO",
        "nb": "nb-NO",
    ]

    private static let inheritLocale: [String: String] = [
        "zh-HK": "zh-TW",
        "es-419": "es-ES",
        "fr-CA": "fr-FR",
        "pt-PT": "pt-BR",
        "nb-NO": "da-DK",
    ]

    public static func inheritedLocale(for locale: String) -> String? {
        inheritLocale[locale]
    }

    public static func displayName(for code: String) -> String {
        if code == CodexLocaleCatalog.auto {
            return CodexLocaleCatalog.auto
        }
        if code == appLocale {
            return "English"
        }
        let locale = Locale(identifier: code)
        if let name = locale.localizedString(forIdentifier: code) {
            return name.prefix(1).uppercased() + name.dropFirst()
        }
        return code
    }

    public static func normalize(_ tag: String) -> String {
        let trimmed = tag.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if let legacy = legacyTags[trimmed] {
            return legacy
        }
        let parts = trimmed.split(separator: "-").map(String.init)
        guard let language = parts.first else { return "" }
        if parts.count == 1 {
            return language.lowercased()
        }
        let rest = parts.dropFirst().map { part -> String in
            if part.count == 2 { return part.uppercased() }
            if part.count == 4 {
                return part.prefix(1).uppercased() + part.dropFirst().lowercased()
            }
            return part
        }
        let candidate = ([language.lowercased()] + rest).joined(separator: "-")
        return legacyTags[candidate] ?? candidate
    }

    public static func resolve(preference: String, navigatorLanguage: String = Locale.current.identifier) -> String {
        let normalizedPreference = normalize(preference)
        if normalizedPreference.isEmpty || normalizedPreference == CodexLocaleCatalog.auto {
            return resolveTag(navigatorLanguage)
        }
        return resolveTag(normalizedPreference)
    }

    public static func migratePreference(_ raw: String) -> String {
        switch raw {
        case "zhHant", "zh-Hant":
            return "zh-TW"
        case "en":
            return appLocale
        case CodexLocaleCatalog.auto:
            return CodexLocaleCatalog.auto
        default:
            return raw
        }
    }

    private static func resolveTag(_ tag: String) -> String {
        let normalized = normalize(tag)
        if normalized.isEmpty { return appLocale }
        if normalized == appLocale || codexLocales.contains(normalized) {
            return normalized
        }
        if let inherited = inheritLocale[normalized], inherited == appLocale || codexLocales.contains(inherited) {
            return inherited
        }
        let language = normalized.split(separator: "-").first.map(String.init) ?? normalized
        if language == appLocale { return appLocale }
        if codexLocales.contains(language) { return language }
        if let regional = codexLocales.first(where: { $0.lowercased().hasPrefix("\(language.lowercased())-") }) {
            return regional
        }
        return appLocale
    }
}
