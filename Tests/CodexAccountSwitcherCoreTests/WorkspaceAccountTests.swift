import XCTest
@testable import CodexAccountSwitcherCore

final class WorkspaceAccountTests: XCTestCase {
    func testSameEmailWorkspacesSurviveAddingSwitchingAndTokenRefresh() throws {
        try withStore { store in
            let personal = workspaceAuth("personal", plan: "plus")
            let business = workspaceAuth("business", plan: "team")
            try personal.write(to: store.authPath, atomically: true, encoding: .utf8)
            _ = try store.saveCurrentAccount(named: "personal")
            try business.write(to: store.authPath, atomically: true, encoding: .utf8)
            var state = try store.readState()
            XCTAssertEqual(state.accounts.map(\.name), ["account", "personal"])
            XCTAssertEqual(state.current, "account")
            XCTAssertEqual(try contents(store.accountPath("personal")), personal)
            XCTAssertEqual(try contents(store.accountPath("account")), business)
            XCTAssertTrue(state.accounts.first { $0.name == "personal" }!.displayLabel.contains("Plus"))
            XCTAssertTrue(state.accounts.first { $0.name == "account" }!.displayLabel.contains("Business"))

            _ = try store.switchToAccount(named: "personal")
            XCTAssertEqual(try contents(store.authPath), personal)
            let refreshed = workspaceAuth("personal", plan: "pro", email: "SAME@example.com", revision: "refreshed")
            try refreshed.write(to: store.authPath, atomically: true, encoding: .utf8)
            state = try store.readState()
            XCTAssertEqual(state.accounts.map(\.name), ["account", "personal"])
            XCTAssertEqual(state.current, "personal")
            XCTAssertEqual(try contents(store.accountPath("personal")), refreshed)
            XCTAssertEqual(try contents(store.accountPath("account")), business)
        }
    }

    func testManualSaveRefusesToReplaceAnotherWorkspace() throws {
        try withStore { store in
            let personal = workspaceAuth("personal", plan: "plus")
            let business = workspaceAuth("business", plan: "team")
            try personal.write(to: store.authPath, atomically: true, encoding: .utf8)
            _ = try store.saveCurrentAccount(named: "saved")
            try business.write(to: store.authPath, atomically: true, encoding: .utf8)
            XCTAssertThrowsError(try store.saveCurrentAccount(named: "saved")) { error in
                XCTAssertEqual(error as? AccountStoreError, .accountNameInUse("saved"))
            }
            XCTAssertEqual(try contents(store.accountPath("saved")), personal)
            XCTAssertEqual(try contents(store.authPath), business)
        }
    }

    func testUnknownLegacyWorkspaceIsPreservedAndStaleCurrentMarkerIsIgnored() throws {
        try withStore { store in
            let legacy = #"{"email":"same@example.com"}"#
            try legacy.write(to: store.accountPath("legacy"), atomically: true, encoding: .utf8)
            try workspaceAuth("business", plan: "team").write(to: store.authPath, atomically: true, encoding: .utf8)
            try "legacy\n".write(to: store.currentAccountPath, atomically: true, encoding: .utf8)
            XCTAssertNil(try store.readState(autosaveActiveAuth: false).current)
            XCTAssertEqual(try store.readState().accounts.map(\.name), ["account", "legacy"])
            XCTAssertEqual(try contents(store.accountPath("legacy")), legacy)
        }
    }

    func testDeduplicationOnlyMergesTheSameUserAndWorkspace() throws {
        try withStore { store in
            let snapshots = [
                "personal": workspaceAuth("personal", plan: "plus"),
                "business-old": workspaceAuth("business", plan: "team"),
                "business-current": workspaceAuth("business", plan: "team", revision: "refreshed"),
                "second-business": workspaceAuth("second-business", plan: "team"),
                "other-user": workspaceAuth("business", plan: "team", email: "other@example.com"),
            ]
            for (name, raw) in snapshots { try raw.write(to: store.accountPath(name), atomically: true, encoding: .utf8) }
            try snapshots["business-current"]!.write(to: store.authPath, atomically: true, encoding: .utf8)
            let state = try store.readState()
            XCTAssertEqual(state.accounts.map(\.name), ["business-current", "other-user", "personal", "second-business"])
            XCTAssertEqual(state.current, "business-current")
            XCTAssertEqual(Set(state.accounts.map(\.displayLabel)).count, 4)
        }
    }

    func testIdentityUsesSelectedWorkspaceAndDoesNotUseOrganizationMemberships() throws {
        let raw = authJSON(tokens: ["account_id": "selected", "id_token": jwt([
            "email": "same@example.com",
            "https://api.openai.com/auth": [
                "chatgpt_account_id": "other", "chatgpt_plan_type": "team",
                "organizations": [["id": "membership", "is_default": true, "title": "Other organization"]],
            ],
        ])])
        let identity = try XCTUnwrap(AuthIdentity.from(raw))
        XCTAssertEqual(identity.accountID, "selected")
        XCTAssertNil(identity.planType)
        XCTAssertEqual(identity.workspaceLabel, "selected")
        XCTAssertEqual(identity.key, AuthIdentity.from(workspaceAuth("selected", plan: "plus"))?.key)
    }

    func testIdentityFallsBackToTokenClaimsAndReadsNestedProfileEmail() throws {
        let metadata = ["chatgpt_account_id": "workspace", "chatgpt_plan_type": "enterprise"]
        let raw = authJSON(tokens: ["id_token": jwt([
            "https://api.openai.com/profile": ["email": "nested@example.com"],
            "https://api.openai.com/auth": metadata,
        ])])
        let identity = try XCTUnwrap(AuthIdentity.from(raw))
        XCTAssertEqual(identity.email, "nested@example.com")
        XCTAssertEqual(identity.accountID, "workspace")
        XCTAssertTrue(identity.workspaceLabel!.hasPrefix("Enterprise"))
        let access = authJSON(tokens: ["access_token": jwt(["https://api.openai.com/auth": metadata])], email: "nested@example.com")
        XCTAssertEqual(AuthIdentity.from(access)?.key, identity.key)
    }

    func testUnknownWorkspacePlansAndUsersStaySeparate() {
        let legacy = { (plan: String) in authJSON(tokens: ["id_token": jwt([
            "https://api.openai.com/auth": ["chatgpt_plan_type": plan],
        ])], email: "same@example.com") }
        XCTAssertNotEqual(AuthIdentity.from(legacy("plus"))?.key, AuthIdentity.from(legacy("team"))?.key)
        let user = { (name: String) in authJSON(tokens: ["account_id": "shared", "id_token": jwt([
            "https://api.openai.com/auth": ["chatgpt_user_id": name],
        ])]) }
        XCTAssertNotEqual(AuthIdentity.from(user("one"))?.key, AuthIdentity.from(user("two"))?.key)
        XCTAssertNil(AuthIdentity.from(authJSON(tokens: ["account_id": "shared"]))?.key)
        XCTAssertNil(AuthIdentity.from("invalid JSON"))
    }
}

private func withStore(_ body: (AccountStore) throws -> Void) throws {
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("workspace-tests-\(UUID().uuidString)")
    let store = AccountStore(homeDirectory: home)
    try FileManager.default.createDirectory(at: store.accountsDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: home) }
    try body(store)
}

private func contents(_ url: URL) throws -> String { try String(contentsOf: url, encoding: .utf8) }

private func workspaceAuth(_ accountID: String, plan: String, email: String = "same@example.com", revision: String = "original") -> String {
    authJSON(tokens: ["account_id": accountID, "access_token": revision, "id_token": jwt([
        "email": email, "https://api.openai.com/auth": ["chatgpt_account_id": accountID, "chatgpt_plan_type": plan],
    ])])
}

private func authJSON(tokens: [String: Any], email: String? = nil) -> String {
    var auth: [String: Any] = ["tokens": tokens]
    if let email { auth["email"] = email }
    return String(data: try! JSONSerialization.data(withJSONObject: auth, options: .sortedKeys), encoding: .utf8)!
}

private func jwt(_ claims: [String: Any]) -> String {
    let data = try! JSONSerialization.data(withJSONObject: claims, options: .sortedKeys)
    let payload = data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    return "header.\(payload).signature"
}
