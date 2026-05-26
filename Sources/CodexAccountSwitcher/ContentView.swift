import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                header
                statusGrid
                accountList
                actionBar
                if let message = model.message {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(24)
            .task {
                model.refresh()
            }
            .navigationTitle(LocalizedText.appTitle)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(LocalizedText.appTitle)
                .font(.title.bold())
            Text(LocalizedText.subtitle)
                .foregroundStyle(.secondary)
        }
    }

    private var statusGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
            GridRow {
                StatusTile(title: LocalizedText.codexPath, value: model.codexApp.path)
                StatusTile(title: LocalizedText.codexVersion, value: model.helperResult?.status?.codexVersion ?? "-")
            }
            GridRow {
                StatusTile(title: LocalizedText.injectionStatus, value: (model.helperResult?.status?.isInjected ?? false) ? LocalizedText.injected : LocalizedText.notInjected)
                StatusTile(title: LocalizedText.bridge, value: model.bridgeStatusText)
            }
            GridRow {
                StatusTile(title: LocalizedText.debugPort, value: model.helperResult?.status?.debugPort.map(String.init) ?? "-")
                StatusTile(title: LocalizedText.codexTarget, value: (model.helperResult?.status?.hasCodexTarget ?? false) ? LocalizedText.ready : LocalizedText.notReady)
            }
        }
    }

    private var accountList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LocalizedText.accounts)
                .font(.headline)
            if let state = model.accountState, !state.accounts.isEmpty {
                List(state.accounts) { account in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(account.email ?? account.name)
                                .font(.body)
                            Text(account.name)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if account.isCurrent {
                            Text(LocalizedText.current)
                                .font(.caption.bold())
                                .foregroundStyle(.green)
                        }
                    }
                    .padding(.vertical, 3)
                }
                .frame(minHeight: 160)
            } else {
                Text(LocalizedText.noAccounts)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private var actionBar: some View {
        HStack(spacing: 10) {
            Button(LocalizedText.refresh) { model.refresh() }
            Button(LocalizedText.launchInject) { model.install() }
                .keyboardShortcut("i", modifiers: [.command])
            Button(LocalizedText.reinject) { model.repair() }
            Button(LocalizedText.stopBridge, role: .destructive) { model.uninstall() }
            Spacer()
            Button(LocalizedText.openCodex) { model.openCodex() }
            Button(LocalizedText.revealLogs) { model.revealLogs() }
        }
        .disabled(model.isBusy)
    }
}

private struct StatusTile: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .lineLimit(2)
                .textSelection(.enabled)
                .font(.system(.body, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
    }
}
