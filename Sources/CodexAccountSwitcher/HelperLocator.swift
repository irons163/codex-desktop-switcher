import Foundation
import CodexAccountSwitcherCore

enum HelperLocator {
    static var defaultCodexApp: URL {
        URL(fileURLWithPath: "/Applications/Codex.app")
    }

    static var defaultUserRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/codex-account-switcher", isDirectory: true)
    }

    static func runner(codexApp: URL = defaultCodexApp, userRoot: URL = defaultUserRoot) throws -> RuntimeHelperRunner {
        RuntimeHelperRunner(
            helperScript: try helperScriptURL(),
            codexApp: codexApp,
            userRoot: userRoot
        )
    }

    static func helperScriptURL() throws -> URL {
        let resourceURL = Bundle.module.resourceURL
        let candidates: [URL?] = [
            resourceURL?.appendingPathComponent("Resources/cdp-helper/cli.js"),
            resourceURL?.appendingPathComponent("cdp-helper/cli.js"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("Sources/CodexAccountSwitcher/Resources/cdp-helper/cli.js")
        ]
        for candidate in candidates.compactMap({ $0 }) {
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        throw HelperLocationError.missingHelper
    }

}

enum HelperLocationError: LocalizedError {
    case missingHelper

    var errorDescription: String? {
        "Bundled CDP helper was not found."
    }
}
