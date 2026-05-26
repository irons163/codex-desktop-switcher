import Foundation

public enum AuthEmailExtractor {
    public static func email(from raw: String) -> String? {
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return email(from: object)
    }

    public static func email(from auth: [String: Any]) -> String? {
        if let direct = validEmail(auth["email"]) {
            return direct
        }
        if let user = auth["user"] as? [String: Any], let email = validEmail(user["email"]) {
            return email
        }
        if let account = auth["account"] as? [String: Any], let email = validEmail(account["email"]) {
            return email
        }
        guard let tokens = auth["tokens"] as? [String: Any],
              let idToken = tokens["id_token"] as? String else {
            return nil
        }
        return emailFromIDToken(idToken)
    }

    private static func validEmail(_ value: Any?) -> String? {
        guard let email = value as? String, email.contains("@") else {
            return nil
        }
        return email
    }

    private static func emailFromIDToken(_ token: String) -> String? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2,
              let payloadData = Data(base64URLFragment: String(parts[1])),
              let claims = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any] else {
            return nil
        }
        return validEmail(claims["email"])
    }
}

extension Data {
    init?(base64URLFragment: String) {
        var base64 = base64URLFragment
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = (4 - base64.count % 4) % 4
        if padding > 0 {
            base64.append(String(repeating: "=", count: padding))
        }
        self.init(base64Encoded: base64)
    }
}

