import Foundation

enum LocalizedText {
    static var isTraditionalChinese: Bool {
        Locale.preferredLanguages.first?.lowercased().hasPrefix("zh") == true
    }

    static func choose(_ zh: String, _ en: String) -> String {
        isTraditionalChinese ? zh : en
    }

    static let appTitle = choose("Codex 帳號切換器", "Codex Account Switcher")
    static let subtitle = choose("用外部啟動器與 CDP 注入帳號切換 UI，不修改 Codex.app。", "Inject account switching through an external CDP launcher without modifying Codex.app.")
    static let codexPath = choose("Codex 路徑", "Codex path")
    static let codexVersion = choose("Codex 版本", "Codex version")
    static let injectionStatus = choose("注入狀態", "Injection status")
    static let bridge = choose("Bridge", "Bridge")
    static let debugPort = choose("Debug Port", "Debug port")
    static let codexTarget = choose("Codex Target", "Codex target")
    static let installed = choose("已安裝", "Installed")
    static let notInstalled = choose("未安裝", "Not installed")
    static let injected = choose("已注入", "Injected")
    static let notInjected = choose("未注入", "Not injected")
    static let running = choose("執行中", "Running")
    static let notRunning = choose("未執行", "Not running")
    static let ready = choose("就緒", "Ready")
    static let notReady = choose("未就緒", "Not ready")
    static let accounts = choose("已保存帳號", "Saved accounts")
    static let noAccounts = choose("尚未保存帳號。先用本 App 啟動 Codex，再在 Codex 內 Accounts 區塊儲存目前帳號。", "No saved accounts yet. Launch Codex from this app, then save the current account from the Accounts area inside Codex.")
    static let current = choose("目前", "Current")
    static let refresh = choose("重新整理", "Refresh")
    static let launchInject = choose("啟動並注入", "Launch + Inject")
    static let reinject = choose("重新注入", "Reinject")
    static let stopBridge = choose("停止 Bridge", "Stop Bridge")
    static let openCodex = choose("啟動 Codex", "Launch Codex")
    static let revealLogs = choose("顯示 Log", "Reveal Logs")

    static func done(_ action: String) -> String {
        choose("\(action) 完成", "\(action) finished")
    }
}
