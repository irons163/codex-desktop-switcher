import Foundation

enum AppResources {
    static let bundle: Bundle = {
        let name = "CodexAccountSwitcher_CodexAccountSwitcher.bundle"
        if let url = Bundle.main.resourceURL?.appendingPathComponent(name),
           let bundle = Bundle(url: url) {
            return bundle
        }
        return Bundle.module
    }()
}
