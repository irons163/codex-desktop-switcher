import Foundation

public struct AccountSnapshot: Codable, Equatable, Identifiable {
    public var id: String { name }
    public let name: String
    public let email: String?
    public let isCurrent: Bool
    public let modifiedAt: Date
    public let usage: AccountUsage?

    public init(name: String, email: String?, isCurrent: Bool, modifiedAt: Date, usage: AccountUsage? = nil) {
        self.name = name
        self.email = email
        self.isCurrent = isCurrent
        self.modifiedAt = modifiedAt
        self.usage = usage
    }
}

public struct AccountUsage: Codable, Equatable {
    public let fiveHour: UsageWindow?
    public let weekly: UsageWindow?
    public let at: Date?

    public init(fiveHour: UsageWindow?, weekly: UsageWindow?, at: Date?) {
        self.fiveHour = fiveHour
        self.weekly = weekly
        self.at = at
    }
}

public struct UsageWindow: Codable, Equatable {
    public let label: String?
    public let pct: Int
    public let resetAt: String?

    public init(label: String?, pct: Int, resetAt: String?) {
        self.label = label
        self.pct = pct
        self.resetAt = resetAt
    }
}

public struct AccountState: Codable, Equatable {
    public let accounts: [AccountSnapshot]
    public let current: String?
    public let hasActiveAuth: Bool
    public let authPath: URL
    public let accountsDirectory: URL
    public let currentAccountPath: URL

    public init(
        accounts: [AccountSnapshot],
        current: String?,
        hasActiveAuth: Bool,
        authPath: URL,
        accountsDirectory: URL,
        currentAccountPath: URL
    ) {
        self.accounts = accounts
        self.current = current
        self.hasActiveAuth = hasActiveAuth
        self.authPath = authPath
        self.accountsDirectory = accountsDirectory
        self.currentAccountPath = currentAccountPath
    }
}

public enum AccountStoreError: LocalizedError, Equatable {
    case invalidAccountName(String)
    case missingActiveAuth(URL)
    case missingSavedAccount(String)

    public var errorDescription: String? {
        switch self {
        case .invalidAccountName:
            "Use letters, numbers, dots, underscores, or dashes. The name must start with a letter or number."
        case .missingActiveAuth(let url):
            "No active Codex auth file found at \(url.path)"
        case .missingSavedAccount(let name):
            "Saved account not found: \(name)"
        }
    }
}
