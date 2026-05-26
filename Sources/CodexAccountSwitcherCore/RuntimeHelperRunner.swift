import Foundation

public struct HelperCommandResult: Codable, Equatable {
    public let ok: Bool
    public let status: RuntimeStatusPayload?
    public let state: RuntimeStatePayload?
    public let error: HelperErrorPayload?
    public let rawOutput: String?

    public func requireSuccess() throws {
        guard ok else {
            throw HelperCommandFailure(message: error?.message ?? rawOutput ?? "Helper command failed.")
        }
    }
}

public struct HelperCommandFailure: LocalizedError, Equatable {
    public let message: String

    public init(message: String) {
        self.message = message
    }

    public var errorDescription: String? {
        message
    }
}

public struct RuntimeStatusPayload: Codable, Equatable {
    public let codexPath: String
    public let codexVersion: String?
    public let mode: String?
    public let isInjected: Bool?
    public let bridgeRunning: Bool?
    public let debugPort: Int?
    public let bridgePort: Int?
    public let isRunning: Bool?
    public let isDebugPortReady: Bool?
    public let hasCodexTarget: Bool?
    public let lastError: String?
}

public struct RuntimeStatePayload: Codable, Equatable {
    public let launchedAt: String?
    public let stoppedAt: String?
    public let signingMode: String?
    public let bridgePort: Int?
    public let debugPort: Int?
}

public struct HelperErrorPayload: Codable, Equatable {
    public let message: String
    public let code: String?

    public init(message: String, code: String?) {
        self.message = message
        self.code = code
    }
}

public struct RuntimeHelperRunner {
    public let helperScript: URL
    public let codexApp: URL
    public let userRoot: URL
    public let nodeExecutable: URL?

    public init(helperScript: URL, codexApp: URL, userRoot: URL, nodeExecutable: URL? = nil) {
        self.helperScript = helperScript
        self.codexApp = codexApp
        self.userRoot = userRoot
        self.nodeExecutable = nodeExecutable
    }

    public func status() throws -> HelperCommandResult {
        try run("status")
    }

    public func install() throws -> HelperCommandResult {
        try run("launch")
    }

    public func repair(quiet: Bool = false) throws -> HelperCommandResult {
        try run("inject", extraArguments: quiet ? ["--quiet"] : [])
    }

    public func uninstall() throws -> HelperCommandResult {
        try run("stop")
    }

    public func run(_ command: String, extraArguments: [String] = []) throws -> HelperCommandResult {
        let process = Process()
        let node = nodeExecutable ?? Self.defaultNodeExecutable(codexApp: codexApp)
        if let node {
            process.executableURL = node
            process.arguments = [helperScript.path, command]
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", helperScript.path, command]
        }
        process.arguments?.append(contentsOf: [
            "--codex-app", codexApp.path,
            "--user-root", userRoot.path,
            "--json"
        ])
        process.arguments?.append(contentsOf: extraArguments)

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        process.waitUntilExit()

        let output = String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let errorOutput = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let payloadData = output.data(using: .utf8) ?? Data()
        var decoded = try? JSONDecoder().decode(HelperCommandResult.self, from: payloadData)
        if decoded == nil {
            decoded = HelperCommandResult(
                ok: false,
                status: nil,
                state: nil,
                error: HelperErrorPayload(message: output.isEmpty ? errorOutput : output, code: "invalid-output"),
                rawOutput: output
            )
        }
        var result = decoded!
        result = HelperCommandResult(
            ok: result.ok && process.terminationStatus == 0,
            status: result.status,
            state: result.state,
            error: result.error,
            rawOutput: output
        )
        return result
    }

    public static func defaultNodeExecutable(codexApp: URL) -> URL? {
        let bundled = codexApp
            .appendingPathComponent("Contents/Resources/node")
        if FileManager.default.isExecutableFile(atPath: bundled.path) {
            return bundled
        }
        return nil
    }
}
