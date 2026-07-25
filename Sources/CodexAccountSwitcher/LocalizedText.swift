import Foundation
import CodexAccountSwitcherCore

struct LocalizedText {
    private let catalog: MessageCatalog
    private let preference: String

    init(catalog: MessageCatalog, preference: String) {
        self.catalog = catalog
        self.preference = preference
    }

    private func t(_ key: String) -> String {
        catalog.text(key, locale: preference)
    }

    var appTitle: String { t("appTitle") }
    var subtitle: String { t("subtitle") }
    var language: String { t("language") }
    var languageAuto: String { t("languageAuto") }
    var codexPath: String { t("codexPath") }
    var codexVersion: String { t("codexVersion") }
    var injectionStatus: String { t("injectionStatus") }
    var bridge: String { t("bridge") }
    var debugPort: String { t("debugPort") }
    var codexTarget: String { t("codexTarget") }
    var injected: String { t("injected") }
    var notInjected: String { t("notInjected") }
    var running: String { t("running") }
    var notRunning: String { t("notRunning") }
    var ready: String { t("ready") }
    var notReady: String { t("notReady") }
    var accounts: String { t("accounts") }
    var noAccounts: String { t("noAccounts") }
    var current: String { t("current") }
    var refresh: String { t("refresh") }
    var launch: String { t("launch") }
    var advanced: String { t("advanced") }
    var reinject: String { t("reinject") }
    var stopBridge: String { t("stopBridge") }
    var revealLogs: String { t("revealLogs") }

    func done(_ action: String) -> String {
        t("doneFinished").replacingOccurrences(of: "{action}", with: action)
    }

    func localeDisplayName(_ code: String) -> String {
        if code == CodexLocaleCatalog.auto {
            return languageAuto
        }
        return CodexLocaleCatalog.displayName(for: code)
    }
}

enum LocalizationSupport {
    static let catalog: MessageCatalog = {
        let candidates = [
            Bundle.module.url(forResource: "messages", withExtension: "json", subdirectory: "locales"),
            Bundle.module.resourceURL?.appendingPathComponent("locales/messages.json"),
            URL(fileURLWithPath: "Sources/CodexAccountSwitcher/Resources/locales/messages.json"),
        ].compactMap { $0 }

        for url in candidates where FileManager.default.fileExists(atPath: url.path) {
            if let catalog = try? MessageCatalog.load(from: url) {
                return catalog
            }
        }
        return MessageCatalog(messages: [:])
    }()
}
