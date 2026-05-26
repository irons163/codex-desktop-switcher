import Foundation

public enum AccountName {
    public static func normalize(_ rawName: String) throws -> String {
        let trimmed = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = trimmed.replacingOccurrences(
            of: #"(?i)\.json$"#,
            with: "",
            options: .regularExpression
        )
        let pattern = #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#
        guard !name.isEmpty, name.range(of: pattern, options: .regularExpression) != nil else {
            throw AccountStoreError.invalidAccountName(rawName)
        }
        return name
    }
}

public final class AccountStore {
    public let homeDirectory: URL
    public let fileManager: FileManager

    public init(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser, fileManager: FileManager = .default) {
        self.homeDirectory = homeDirectory
        self.fileManager = fileManager
    }

    public var codexDirectory: URL {
        homeDirectory.appendingPathComponent(".codex", isDirectory: true)
    }

    public var authPath: URL {
        codexDirectory.appendingPathComponent("auth.json")
    }

    public var accountsDirectory: URL {
        codexDirectory.appendingPathComponent("auth_accounts", isDirectory: true)
    }

    public var usageCachePath: URL {
        codexDirectory.appendingPathComponent("auth_accounts_usage.json")
    }

    public var currentAccountPath: URL {
        codexDirectory.appendingPathComponent("current_account")
    }

    public func accountPath(_ name: String) -> URL {
        accountsDirectory.appendingPathComponent("\(name).json")
    }

    @discardableResult
    public func saveCurrentAccount(named rawName: String) throws -> AccountState {
        let name = try AccountName.normalize(rawName)
        guard fileManager.fileExists(atPath: authPath.path) else {
            throw AccountStoreError.missingActiveAuth(authPath)
        }
        try fileManager.createDirectory(at: accountsDirectory, withIntermediateDirectories: true)
        try replaceFile(at: accountPath(name), withContentsOf: authPath)
        try "\(name)\n".write(to: currentAccountPath, atomically: true, encoding: .utf8)
        return try readState()
    }

    @discardableResult
    public func switchToAccount(named rawName: String) throws -> AccountState {
        let name = try AccountName.normalize(rawName)
        let source = accountPath(name)
        guard fileManager.fileExists(atPath: source.path) else {
            throw AccountStoreError.missingSavedAccount(name)
        }
        try fileManager.createDirectory(at: codexDirectory, withIntermediateDirectories: true)
        try replaceFile(at: authPath, withContentsOf: source)
        try "\(name)\n".write(to: currentAccountPath, atomically: true, encoding: .utf8)
        return try readState()
    }

    @discardableResult
    public func deleteAccount(named rawName: String) throws -> AccountState {
        let name = try AccountName.normalize(rawName)
        try? fileManager.removeItem(at: accountPath(name))
        if (try? String(contentsOf: currentAccountPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)) == name {
            try? fileManager.removeItem(at: currentAccountPath)
        }
        return try readState(autosaveActiveAuth: false)
    }

    @discardableResult
    public func clearActiveAuthForNewSignIn() throws -> AccountState {
        try fileManager.createDirectory(at: codexDirectory, withIntermediateDirectories: true)
        if fileManager.fileExists(atPath: authPath.path) {
            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let backup = codexDirectory.appendingPathComponent("auth.account-switcher-backup-\(stamp).json")
            try replaceFile(at: backup, withContentsOf: authPath)
            try fileManager.removeItem(at: authPath)
        }
        try? fileManager.removeItem(at: currentAccountPath)
        return try readState(autosaveActiveAuth: false)
    }

    public func readState(autosaveActiveAuth: Bool = true) throws -> AccountState {
        if autosaveActiveAuth {
            _ = try ensureAutosavedActiveAccount()
        }
        let allNames = try listAccountNames()
        let visible = try selectVisibleAccounts(from: allNames)
        let visibleNames = visible.map(\.name)
        let current = try currentAccountName(among: visibleNames)
        let usage = try readUsage()
        let snapshots = visible.map { detail in
            AccountSnapshot(
                name: detail.name,
                email: detail.email,
                isCurrent: detail.name == current,
                modifiedAt: detail.modifiedAt,
                usage: usage[detail.name]
            )
        }
        return AccountState(
            accounts: snapshots,
            current: current,
            hasActiveAuth: fileManager.fileExists(atPath: authPath.path),
            authPath: authPath,
            accountsDirectory: accountsDirectory,
            currentAccountPath: currentAccountPath
        )
    }

    public func listAccountNames() throws -> [String] {
        guard fileManager.fileExists(atPath: accountsDirectory.path) else {
            return []
        }
        return try fileManager.contentsOfDirectory(at: accountsDirectory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension.lowercased() == "json" }
            .map { $0.deletingPathExtension().lastPathComponent }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private func ensureAutosavedActiveAccount() throws -> String? {
        guard fileManager.fileExists(atPath: authPath.path) else {
            return nil
        }
        let accounts = try listAccountNames()
        if let matched = try findMatchingAccountByContents(accounts) {
            try "\(matched)\n".write(to: currentAccountPath, atomically: true, encoding: .utf8)
            return matched
        }

        let active = try String(contentsOf: authPath, encoding: .utf8)
        if let sameEmail = try findMatchingAccountByEmail(accounts, activeContents: active) {
            try replaceFile(at: accountPath(sameEmail), withContentsOf: authPath)
            try "\(sameEmail)\n".write(to: currentAccountPath, atomically: true, encoding: .utf8)
            return sameEmail
        }

        try fileManager.createDirectory(at: accountsDirectory, withIntermediateDirectories: true)
        let name = try nextAvailableAccountName(baseName: "account")
        try replaceFile(at: accountPath(name), withContentsOf: authPath)
        try "\(name)\n".write(to: currentAccountPath, atomically: true, encoding: .utf8)
        return name
    }

    private func currentAccountName(among accounts: [String]) throws -> String? {
        guard fileManager.fileExists(atPath: authPath.path) else {
            return nil
        }
        if let matched = try findMatchingAccountByContents(accounts) {
            return matched
        }
        if let marker = try? String(contentsOf: currentAccountPath, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !marker.isEmpty,
           accounts.contains(marker) {
            return marker
        }
        return nil
    }

    private func findMatchingAccountByContents(_ accounts: [String]) throws -> String? {
        guard let active = try? String(contentsOf: authPath, encoding: .utf8) else {
            return nil
        }
        for name in accounts {
            if (try? String(contentsOf: accountPath(name), encoding: .utf8)) == active {
                return name
            }
        }
        return nil
    }

    private func findMatchingAccountByEmail(_ accounts: [String], activeContents: String) throws -> String? {
        guard let activeEmail = AuthEmailExtractor.email(from: activeContents)?.lowercased() else {
            return nil
        }
        let current = try? String(contentsOf: currentAccountPath, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = try accounts.compactMap { name -> AccountDetail? in
            let url = accountPath(name)
            guard let contents = try? String(contentsOf: url, encoding: .utf8),
                  AuthEmailExtractor.email(from: contents)?.lowercased() == activeEmail else {
                return nil
            }
            let modified = try modificationDate(for: url)
            return AccountDetail(name: name, email: activeEmail, isActive: false, modifiedAt: modified, isCurrentMarker: name == current)
        }
        return matches.sorted(by: preferAccountDetail).first?.name
    }

    private func selectVisibleAccounts(from names: [String]) throws -> [AccountDetail] {
        let details = try names.map(readAccountDetail)
        var byIdentity: [String: AccountDetail] = [:]
        for detail in details {
            let key = detail.email.map { "email:\($0.lowercased())" } ?? "name:\(detail.name)"
            if let existing = byIdentity[key] {
                if preferAccountDetail(detail, existing) {
                    byIdentity[key] = detail
                }
            } else {
                byIdentity[key] = detail
            }
        }
        return byIdentity.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func readAccountDetail(_ name: String) throws -> AccountDetail {
        let url = accountPath(name)
        let contents = try? String(contentsOf: url, encoding: .utf8)
        let active = (try? String(contentsOf: authPath, encoding: .utf8)) == contents
        return AccountDetail(
            name: name,
            email: contents.flatMap(AuthEmailExtractor.email(from:)),
            isActive: active,
            modifiedAt: try modificationDate(for: url),
            isCurrentMarker: false
        )
    }

    private func nextAvailableAccountName(baseName: String) throws -> String {
        let accounts = Set(try listAccountNames())
        if !accounts.contains(baseName) {
            return baseName
        }
        for index in 2..<10_000 {
            let name = "\(baseName)-\(index)"
            if !accounts.contains(name) {
                return name
            }
        }
        throw AccountStoreError.invalidAccountName(baseName)
    }

    private func readUsage() throws -> [String: AccountUsage] {
        guard let data = try? Data(contentsOf: usageCachePath),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        var output: [String: AccountUsage] = [:]
        for (name, value) in raw {
            guard let object = value as? [String: Any] else { continue }
            output[name] = AccountUsage(
                fiveHour: usageWindow(object["fiveHour"]),
                weekly: usageWindow(object["weekly"]),
                at: (object["at"] as? TimeInterval).map { Date(timeIntervalSince1970: $0 / 1000) }
            )
        }
        return output
    }

    private func usageWindow(_ value: Any?) -> UsageWindow? {
        guard let object = value as? [String: Any],
              let pctValue = object["pct"] as? NSNumber else {
            return nil
        }
        return UsageWindow(label: object["label"] as? String, pct: pctValue.intValue, resetAt: object["resetAt"] as? String)
    }

    private func modificationDate(for url: URL) throws -> Date {
        let attributes = try fileManager.attributesOfItem(atPath: url.path)
        return attributes[.modificationDate] as? Date ?? .distantPast
    }

    private func replaceFile(at destination: URL, withContentsOf source: URL) throws {
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.copyItem(at: source, to: destination)
    }
}

private struct AccountDetail {
    let name: String
    let email: String?
    let isActive: Bool
    let modifiedAt: Date
    let isCurrentMarker: Bool
}

private func preferAccountDetail(_ left: AccountDetail, _ right: AccountDetail) -> Bool {
    if left.isActive != right.isActive {
        return left.isActive
    }
    if left.isCurrentMarker != right.isCurrentMarker {
        return left.isCurrentMarker
    }
    if left.modifiedAt != right.modifiedAt {
        return left.modifiedAt > right.modifiedAt
    }
    return left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending
}

