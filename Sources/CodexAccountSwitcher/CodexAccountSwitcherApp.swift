import SwiftUI
import CodexAccountSwitcherCore

@main
struct CodexAccountSwitcherApp: App {
    @StateObject private var model: AppModel

    init() {
        if CommandLineController.isCommandLineMode {
            Foundation.exit(CommandLineController.run())
        }
        _model = StateObject(wrappedValue: AppModel())
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .frame(minWidth: 760, minHeight: 560)
        }
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}

