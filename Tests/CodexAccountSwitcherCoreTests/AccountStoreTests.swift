import XCTest
@testable import CodexAccountSwitcherCore

final class AccountStoreTests: XCTestCase {
    func testAuthSnapshotsAndBackupsUsePrivatePermissions() throws {
        try withTemporaryHome { home in
            let store = AccountStore(homeDirectory: home)
            try store.fileManager.createDirectory(at: store.codexDirectory, withIntermediateDirectories: true)
            try auth(email: "work@example.com", profile: "work").write(to: store.authPath, atomically: true, encoding: .utf8)
            try store.fileManager.setAttributes([.posixPermissions: 0o644], ofItemAtPath: store.authPath.path)
            _ = try store.saveCurrentAccount(named: "work")
            for directory in [store.codexDirectory, store.accountsDirectory] {
                let permissions = try store.fileManager.attributesOfItem(atPath: directory.path)[.posixPermissions] as? NSNumber
                XCTAssertEqual(permissions?.intValue, 0o700)
            }
            for file in [store.authPath, store.accountPath("work")] {
                let permissions = try store.fileManager.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber
                XCTAssertEqual(permissions?.intValue, 0o600)
            }
            _ = try store.clearActiveAuthForNewSignIn()
            let backup = try store.fileManager.contentsOfDirectory(at: store.codexDirectory, includingPropertiesForKeys: nil)
                .first { $0.lastPathComponent.hasPrefix("auth.account-switcher-backup-") }
            let file = try XCTUnwrap(backup)
            let permissions = try store.fileManager.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber
            XCTAssertEqual(permissions?.intValue, 0o600)
        }
    }

    func testAccountNameValidationAcceptsSafeNamesAndRejectsUnsafeNames() throws {
        XCTAssertEqual(try AccountName.normalize("work.main-2"), "work.main-2")
        XCTAssertEqual(try AccountName.normalize("personal_json.json"), "personal_json")

        XCTAssertThrowsError(try AccountName.normalize("../escape"))
        XCTAssertThrowsError(try AccountName.normalize("-starts-with-dash"))
        XCTAssertThrowsError(try AccountName.normalize("has space"))
        XCTAssertThrowsError(try AccountName.normalize(""))
    }

    func testSavingAuthReplacesSymlinkWithoutChangingItsTarget() throws {
        try withTemporaryHome { home in
            let store = AccountStore(homeDirectory: home)
            try store.fileManager.createDirectory(at: store.accountsDirectory, withIntermediateDirectories: true)
            try auth(email: "work@example.com", profile: "work").write(to: store.authPath, atomically: true, encoding: .utf8)
            let unrelated = home.appendingPathComponent("unrelated.txt")
            try "preserve me".write(to: unrelated, atomically: true, encoding: .utf8)
            try store.fileManager.createSymbolicLink(at: store.accountPath("work"), withDestinationURL: unrelated)
            _ = try store.saveCurrentAccount(named: "work")
            XCTAssertEqual(try String(contentsOf: unrelated, encoding: .utf8), "preserve me")
            let attributes = try store.fileManager.attributesOfItem(atPath: store.accountPath("work").path)
            XCTAssertEqual(attributes[.type] as? FileAttributeType, .typeRegular)
        }
    }

    func testEmailExtractionReadsDirectFieldsAndJWTIdToken() throws {
        XCTAssertEqual(AuthEmailExtractor.email(from: #"{"email":"direct@example.com"}"#), "direct@example.com")
        XCTAssertEqual(AuthEmailExtractor.email(from: #"{"user":{"email":"user@example.com"}}"#), "user@example.com")
        XCTAssertEqual(AuthEmailExtractor.email(from: #"{"account":{"email":"account@example.com"}}"#), "account@example.com")

        let token = makeJWT(email: "jwt@example.com")
        XCTAssertEqual(
            AuthEmailExtractor.email(from: #"{"tokens":{"id_token":"\#(token)"}}"#),
            "jwt@example.com"
        )
    }

    func testSaveSwitchDeleteAndAutosaveUseCodexAccountFiles() throws {
        try withTemporaryHome { home in
            let store = AccountStore(homeDirectory: home)
            try store.fileManager.createDirectory(at: store.codexDirectory, withIntermediateDirectories: true)
            let workAuth = auth(email: "work@example.com", profile: "work")
            let personalAuth = auth(email: "me@example.com", profile: "personal")
            try workAuth.write(to: store.authPath, atomically: true, encoding: .utf8)

            let saved = try store.saveCurrentAccount(named: "work")
            XCTAssertEqual(saved.current, "work")
            XCTAssertEqual(try String(contentsOf: store.accountPath("work"), encoding: .utf8), workAuth)

            try personalAuth.write(to: store.authPath, atomically: true, encoding: .utf8)
            let autosaved = try store.readState()
            XCTAssertEqual(autosaved.current, "account")
            XCTAssertTrue(store.fileManager.fileExists(atPath: store.accountPath("account").path))

            let switched = try store.switchToAccount(named: "work")
            XCTAssertEqual(switched.current, "work")
            XCTAssertEqual(try String(contentsOf: store.authPath, encoding: .utf8), workAuth)

            let deleted = try store.deleteAccount(named: "work")
            XCTAssertNil(deleted.current)
            XCTAssertFalse(store.fileManager.fileExists(atPath: store.accountPath("work").path))
        }
    }

    func testDuplicateEmailsPreferActiveSnapshotThenNewestSnapshot() throws {
        try withTemporaryHome { home in
            let store = AccountStore(homeDirectory: home)
            try store.fileManager.createDirectory(at: store.accountsDirectory, withIntermediateDirectories: true)
            let oldAuth = auth(email: "work@example.com", profile: "old")
            let activeAuth = auth(email: "work@example.com", profile: "active")
            let otherAuth = auth(email: "other@example.com", profile: "other")
            try oldAuth.write(to: store.accountPath("work-old"), atomically: true, encoding: .utf8)
            try activeAuth.write(to: store.accountPath("work-current"), atomically: true, encoding: .utf8)
            try otherAuth.write(to: store.accountPath("other"), atomically: true, encoding: .utf8)
            try activeAuth.write(to: store.authPath, atomically: true, encoding: .utf8)
            try store.fileManager.setAttributes([.modificationDate: Date(timeIntervalSince1970: 10)], ofItemAtPath: store.accountPath("work-old").path)
            try store.fileManager.setAttributes([.modificationDate: Date(timeIntervalSince1970: 5)], ofItemAtPath: store.accountPath("work-current").path)

            var state = try store.readState()
            XCTAssertEqual(state.accounts.map(\.name), ["other", "work-current"])
            XCTAssertEqual(state.current, "work-current")

            try store.fileManager.removeItem(at: store.authPath)
            try store.fileManager.setAttributes([.modificationDate: Date(timeIntervalSince1970: 30)], ofItemAtPath: store.accountPath("work-old").path)
            state = try store.readState()
            XCTAssertEqual(state.accounts.map(\.name), ["other", "work-old"])
        }
    }

    func testHelperCommandResultRequiresSuccessBeforeShowingDone() throws {
        let result = HelperCommandResult(
            ok: false,
            status: nil,
            state: nil,
            error: HelperErrorPayload(message: "Use Launch + Inject first.", code: nil),
            rawOutput: nil
        )

        XCTAssertThrowsError(try result.requireSuccess()) { error in
            XCTAssertEqual(error.localizedDescription, "Use Launch + Inject first.")
        }
    }

    func testNodeExecutableIsResolvedFromPathWhenCodexDoesNotBundleNode() throws {
        try withTemporaryHome { root in
            let bin = root.appendingPathComponent("bin", isDirectory: true)
            let node = bin.appendingPathComponent("node")
            try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
            XCTAssertTrue(FileManager.default.createFile(atPath: node.path, contents: Data()))
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o755],
                ofItemAtPath: node.path
            )

            let resolved = RuntimeHelperRunner.defaultNodeExecutable(
                codexApp: root.appendingPathComponent("Codex.app"),
                environment: ["PATH": bin.path]
            )

            XCTAssertEqual(resolved, node)
        }
    }

    func testPreferencesStorePersistsManualLanguageSelection() throws {
        try withTemporaryHome { root in
            let store = AppPreferencesStore(userRoot: root)
            XCTAssertEqual(store.load(), AppPreferences())

            try store.save(AppPreferences(language: "en"))
            XCTAssertEqual(store.load().language, "en")

            let resolved = store.load().resolvedLocale(navigatorLanguage: "zh-TW")
            XCTAssertEqual(resolved, "en")
        }
    }
}

private func withTemporaryHome(_ body: (URL) throws -> Void) throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("codex-switcher-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try body(root)
}

private func auth(email: String, profile: String) -> String {
    #"{"auth_mode":"chatgpt","profile_id":"\#(profile)","email":"\#(email)","tokens":{"access_token":"access","refresh_token":"refresh"}}"#
}

private func makeJWT(email: String) -> String {
    let header = #"{"alg":"none","typ":"JWT"}"#.data(using: .utf8)!.base64URLEncodedString()
    let payload = #"{"email":"\#(email)"}"#.data(using: .utf8)!.base64URLEncodedString()
    return "\(header).\(payload)."
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
