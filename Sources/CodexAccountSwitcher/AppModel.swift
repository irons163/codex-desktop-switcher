import AppKit
import Foundation
import CodexAccountSwitcherCore

@MainActor
final class AppModel: ObservableObject {
    @Published var accountState: AccountState?
    @Published var helperResult: HelperCommandResult?
    @Published var isBusy = false
    @Published var message: String?

    let accountStore = AccountStore()
    let codexApp = HelperLocator.defaultCodexApp
    let userRoot = HelperLocator.defaultUserRoot

    var bridgeStatusText: String {
        guard let status = helperResult?.status else { return "-" }
        if status.bridgeRunning == true && status.isInjected == true {
            return LocalizedText.injected
        }
        if status.bridgeRunning == true {
            return LocalizedText.running
        }
        return LocalizedText.notRunning
    }

    func refresh() {
        Task {
            await perform("refresh") {
                self.accountState = try self.accountStore.readState()
                self.helperResult = try HelperLocator.runner(codexApp: self.codexApp, userRoot: self.userRoot).status()
            }
        }
    }

    func install() {
        Task {
            await perform("launch") {
                let runner = try HelperLocator.runner(codexApp: self.codexApp, userRoot: self.userRoot)
                let result = try runner.install()
                try self.apply(result, runner: runner)
                self.accountState = try self.accountStore.readState()
            }
        }
    }

    func repair() {
        Task {
            await perform("reinject") {
                let runner = try HelperLocator.runner(codexApp: self.codexApp, userRoot: self.userRoot)
                _ = try? runner.uninstall()
                let result = try runner.install()
                try self.apply(result, runner: runner)
                self.accountState = try self.accountStore.readState()
            }
        }
    }

    func uninstall() {
        Task {
            await perform("stop") {
                let runner = try HelperLocator.runner(codexApp: self.codexApp, userRoot: self.userRoot)
                let result = try runner.uninstall()
                try self.apply(result, runner: runner)
                self.accountState = try self.accountStore.readState(autosaveActiveAuth: false)
            }
        }
    }

    func openCodex() {
        install()
    }

    func revealLogs() {
        let logs = userRoot.appendingPathComponent("log", isDirectory: true)
        NSWorkspace.shared.activateFileViewerSelecting([logs])
    }

    private func perform(_ action: String, _ operation: @escaping () throws -> Void) async {
        isBusy = true
        message = nil
        defer { isBusy = false }
        do {
            try operation()
            message = LocalizedText.done(action)
        } catch {
            message = error.localizedDescription
        }
    }

    private func apply(_ result: HelperCommandResult, runner: RuntimeHelperRunner) throws {
        if result.status != nil || result.ok {
            helperResult = result
        } else if let status = try? runner.status() {
            helperResult = status
        } else {
            helperResult = result
        }
        try result.requireSuccess()
    }
}
