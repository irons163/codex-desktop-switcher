import Foundation
import CodexAccountSwitcherCore

enum CommandLineController {
    static var isCommandLineMode: Bool {
        let args = Set(CommandLine.arguments.dropFirst())
        return args.contains("--install")
            || args.contains("--repair")
            || args.contains("--uninstall")
            || args.contains("--launch")
            || args.contains("--inject")
            || args.contains("--stop")
            || args.contains("--status-json")
    }

    static func run() -> Int32 {
        do {
            let arguments = CommandLine.arguments.dropFirst()
            let codexApp = value(after: "--codex-app", in: Array(arguments))
                .map(URL.init(fileURLWithPath:)) ?? HelperLocator.defaultCodexApp
            let userRoot = value(after: "--user-root", in: Array(arguments))
                .map(URL.init(fileURLWithPath:)) ?? HelperLocator.defaultUserRoot
            let runner = try HelperLocator.runner(codexApp: codexApp, userRoot: userRoot)
            let result: HelperCommandResult

            if arguments.contains("--install") || arguments.contains("--launch") {
                result = try runner.install()
            } else if arguments.contains("--repair") || arguments.contains("--inject") {
                result = try runner.repair(quiet: arguments.contains("--quiet"))
            } else if arguments.contains("--uninstall") || arguments.contains("--stop") {
                result = try runner.uninstall()
            } else {
                result = try runner.status()
            }

            let response = CLIResponse(result: result)
            try writeJSON(response)
            return response.ok ? 0 : 1
        } catch {
            let response = CLIResponse(
                ok: false,
                status: nil,
                state: nil,
                error: HelperErrorPayload(message: error.localizedDescription, code: "swift-cli")
            )
            try? writeJSON(response)
            return 1
        }
    }

    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }

    private static func writeJSON<T: Encodable>(_ value: T) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        FileHandle.standardOutput.write(try encoder.encode(value))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

private struct CLIResponse: Encodable {
    let ok: Bool
    let status: RuntimeStatusPayload?
    let state: RuntimeStatePayload?
    let error: HelperErrorPayload?

    init(result: HelperCommandResult) {
        ok = result.ok
        status = result.status
        state = result.state
        error = result.error
    }

    init(
        ok: Bool,
        status: RuntimeStatusPayload?,
        state: RuntimeStatePayload?,
        error: HelperErrorPayload?
    ) {
        self.ok = ok
        self.status = status
        self.state = state
        self.error = error
    }
}
