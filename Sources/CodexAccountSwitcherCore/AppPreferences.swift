import Foundation

public struct AppPreferences: Codable, Equatable, Sendable {
    public var language: String

    public init(language: String = CodexLocaleCatalog.auto) {
        self.language = language
    }

    public func resolvedLocale(navigatorLanguage: String = Locale.current.identifier) -> String {
        CodexLocaleCatalog.resolve(preference: language, navigatorLanguage: navigatorLanguage)
    }
}

public struct AppPreferencesStore {
    public static let fileName = "preferences.json"

    public let userRoot: URL

    public init(userRoot: URL) {
        self.userRoot = userRoot
    }

    public var preferencesURL: URL {
        userRoot.appendingPathComponent(Self.fileName)
    }

    public func load() -> AppPreferences {
        guard let data = try? Data(contentsOf: preferencesURL) else {
            return AppPreferences()
        }
        if let migrated = migrateLegacyPreferences(data: data) {
            return migrated
        }
        guard let preferences = try? JSONDecoder().decode(AppPreferences.self, from: data) else {
            return AppPreferences()
        }
        return AppPreferences(language: CodexLocaleCatalog.migratePreference(preferences.language))
    }

    public func save(_ preferences: AppPreferences) throws {
        try FileManager.default.createDirectory(at: userRoot, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(preferences).write(to: preferencesURL, options: .atomic)
    }

    private func migrateLegacyPreferences(data: Data) -> AppPreferences? {
        struct LegacyPreferences: Decodable {
            let language: String
        }
        guard let legacy = try? JSONDecoder().decode(LegacyPreferences.self, from: data) else {
            return nil
        }
        return AppPreferences(language: CodexLocaleCatalog.migratePreference(legacy.language))
    }
}
