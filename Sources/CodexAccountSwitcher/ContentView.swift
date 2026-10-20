import SwiftUI
import CodexAccountSwitcherCore

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        let l10n = model.l10n
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                header(l10n)
                languagePicker(l10n)
                statusGrid(l10n)
                accountList(l10n)
                actionBar(l10n)
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
            .navigationTitle(l10n.appTitle)
        }
    }

    private func header(_ l10n: LocalizedText) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l10n.appTitle)
                .font(.title.bold())
            Text(l10n.subtitle)
                .foregroundStyle(.secondary)
        }
    }

    private func languagePicker(_ l10n: LocalizedText) -> some View {
        HStack(spacing: 12) {
            Text(l10n.language)
                .font(.headline)
            Picker(l10n.language, selection: Binding(
                get: { model.preferences.language },
                set: { newValue in
                    var next = model.preferences
                    next.language = CodexLocaleCatalog.migratePreference(newValue)
                    model.preferences = next
                }
            )) {
                Text(l10n.languageAuto).tag(CodexLocaleCatalog.auto)
                ForEach(CodexLocaleCatalog.supportedLocales.filter { $0 != CodexLocaleCatalog.auto }, id: \.self) { code in
                    Text(l10n.localeDisplayName(code)).tag(code)
                }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: 320, alignment: .leading)
        }
    }

    private func statusGrid(_ l10n: LocalizedText) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
            GridRow {
                StatusTile(title: l10n.codexPath, value: model.codexApp.path)
                StatusTile(title: l10n.codexVersion, value: model.helperResult?.status?.codexVersion ?? "-")
            }
            GridRow {
                StatusTile(
                    title: l10n.injectionStatus,
                    value: (model.helperResult?.status?.isInjected ?? false) ? l10n.injected : l10n.notInjected
                )
                StatusTile(title: l10n.bridge, value: model.bridgeStatusText)
            }
            GridRow {
                StatusTile(title: l10n.debugPort, value: model.helperResult?.status?.debugPort.map(String.init) ?? "-")
                StatusTile(
                    title: l10n.codexTarget,
                    value: (model.helperResult?.status?.hasCodexTarget ?? false) ? l10n.ready : l10n.notReady
                )
            }
        }
    }

    private func accountList(_ l10n: LocalizedText) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l10n.accounts)
                .font(.headline)
            if let state = model.accountState, !state.accounts.isEmpty {
                List(state.accounts) { account in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(account.displayLabel)
                                .font(.body)
                            Text(account.name)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if account.isCurrent {
                            Text(l10n.current)
                                .font(.caption.bold())
                                .foregroundStyle(.green)
                        }
                    }
                    .padding(.vertical, 3)
                }
                .frame(minHeight: 160)
            } else {
                Text(l10n.noAccounts)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func actionBar(_ l10n: LocalizedText) -> some View {
        HStack(spacing: 10) {
            Button(l10n.launch) { model.install() }
                .keyboardShortcut("i", modifiers: [.command])
                .buttonStyle(.borderedProminent)
            Button(l10n.refresh) { model.refresh() }
            Spacer()
            Menu {
                Button(l10n.reinject) { model.repair() }
                Button(l10n.stopBridge, role: .destructive) { model.uninstall() }
                Divider()
                Button(l10n.revealLogs) { model.revealLogs() }
            } label: {
                Label(l10n.advanced, systemImage: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
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
