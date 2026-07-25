import Foundation

public struct MessageCatalog: Sendable {
    private let messages: [String: [String: String]]

    public init(messages: [String: [String: String]]) {
        self.messages = messages
    }

    public static func load(from url: URL) throws -> MessageCatalog {
        let data = try Data(contentsOf: url)
        let decoded = try JSONDecoder().decode([String: [String: String]].self, from: data)
        return MessageCatalog(messages: decoded)
    }

    public func text(_ key: String, locale: String, navigatorLanguage: String = Locale.current.identifier) -> String {
        let resolved = CodexLocaleCatalog.resolve(preference: locale, navigatorLanguage: navigatorLanguage)
        return lookup(resolved, key) ?? lookup(CodexLocaleCatalog.appLocale, key) ?? key
    }

    private func lookup(_ locale: String, _ key: String) -> String? {
        if let value = messages[locale]?[key] {
            return value
        }
        if let inherited = CodexLocaleCatalog.inheritedLocale(for: locale),
           let value = messages[inherited]?[key] {
            return value
        }
        return messages[CodexLocaleCatalog.appLocale]?[key]
    }
}
