import Foundation

/// Token claims identify local snapshots; they are not used to authenticate them.
public struct AuthIdentity {
    public let email: String?
    public let accountID: String?
    public let planType: String?
    public let key: String?
    public let workspaceLabel: String?

    public static func from(_ raw: String) -> AuthIdentity? {
        guard let data = raw.data(using: .utf8),
              let auth = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let tokens = auth["tokens"] as? [String: Any] ?? [:]
        let claims = jwtClaims(tokens["id_token"])
        let accessClaims = jwtClaims(tokens["access_token"])
        let metadata = claims["https://api.openai.com/auth"] as? [String: Any]
            ?? accessClaims["https://api.openai.com/auth"] as? [String: Any] ?? [:]
        // Only the selected account ID identifies the workspace, not organization memberships.
        let accountID = nonemptyString(tokens["account_id"]) ?? nonemptyString(metadata["chatgpt_account_id"])
        let email = AuthEmailExtractor.email(from: auth)
        let userID = nonemptyString(metadata["chatgpt_user_id"]) ?? nonemptyString(metadata["user_id"])
        let principal = email.map { "email:\($0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())" }
            ?? userID.map { "user:\($0)" }
        let metadataID = nonemptyString(metadata["chatgpt_account_id"])
        let metadataMatches = accountID == nil || metadataID == nil || metadataID == accountID
        let planType = metadataMatches ? nonemptyString(metadata["chatgpt_plan_type"])?.lowercased() : nil
        let components = principal.map { principal -> [Any] in
            if let accountID { return ["workspace", principal, accountID] }
            return ["legacy", principal, planType as Any? ?? NSNull()]
        }
        let key = components.flatMap { try? JSONSerialization.data(withJSONObject: $0, options: [.withoutEscapingSlashes]) }
            .flatMap { String(data: $0, encoding: .utf8) }
        let planLabels = ["free": "Free", "plus": "Plus", "pro": "Pro", "prolite": "Pro Lite", "team": "Business", "business": "Business", "enterprise": "Enterprise", "edu": "Edu"]
        let label = [planType.flatMap { planLabels[$0] }, accountID.map { String($0.suffix(8)) }]
            .compactMap { $0 }.joined(separator: " · ")
        return AuthIdentity(email: email, accountID: accountID, planType: planType, key: key, workspaceLabel: label.isEmpty ? nil : label)
    }

    private static func nonemptyString(_ value: Any?) -> String? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func jwtClaims(_ value: Any?) -> [String: Any] {
        guard let token = value as? String else { return [:] }
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count >= 2,
              let data = Data(base64URLFragment: String(parts[1])),
              let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return claims
    }
}
