# Codex Account Switcher

**繁體中文** | [English](README.en.md)

使用 SwiftUI 打造的 macOS 原生帳號切換工具，可儲存多個 Codex 帳號，
並直接從桌面程式的個人選單或帳號設定頁切換。

## 下載

**目前版本：[v0.1.2](https://github.com/irons163/codex-desktop-switcher/releases/tag/v0.1.2)**

| Mac 類型 | 安裝檔 |
| --- | --- |
| Apple Silicon（M 系列） | [Apple Silicon DMG](https://github.com/irons163/codex-desktop-switcher/releases/download/v0.1.2/CodexAccountSwitcher-0.1.2-apple-silicon.dmg) |
| Intel | [Intel DMG](https://github.com/irons163/codex-desktop-switcher/releases/download/v0.1.2/CodexAccountSwitcher-0.1.2-intel.dmg) |

兩種安裝檔均使用 Developer ID 簽名並通過 Apple 公證。
[發布頁面](https://github.com/irons163/codex-desktop-switcher/releases/latest)
另提供 `SHA256SUMS` 校驗碼與選用的 `.dSYM.zip` 除錯符號檔。

### 系統需求

- macOS 13 或更新版本。
- 已安裝 Codex 桌面程式，或相容的整合版 ChatGPT 桌面程式。
- 如果桌面程式未內附 Node.js，需要另外安裝 Node.js 22 或更新版本。

## 安裝與使用

1. 依照 Mac 類型下載 DMG，開啟後將 **Codex Account Switcher**
   拖曳到 **Applications／應用程式**。
2. 開啟切換器，按下 **啟動（Launch）**。Codex 可能會重新啟動，
   以載入帳號介面；啟動最多等待 60 秒。
3. 在 Codex 開啟個人選單，或進入 **設定 → 帳號（Settings → Accounts）**。
   使用 **儲存目前帳號（Save current account）** 為目前登入命名並儲存。
4. 使用 **新增登入（New sign-in）** 加入其他帳號。
   工具會先儲存目前帳號，並保留原本登入；新帳號在瀏覽器完成登入後，會自動儲存並重新啟動 Codex。
5. 選擇已儲存的帳號進行切換，Codex 會重新啟動並套用該帳號。

之後需要帳號切換介面時，請透過切換器啟動 Codex。
如果介面未出現，可再次按下 **啟動（Launch）**，再使用 **重新整理（Refresh）**
確認注入與 bridge 狀態。**進階 → 顯示 Log（Advanced → Reveal Logs）** 可開啟紀錄資料夾。

## 功能

- 儲存多個帳號，從 Codex 個人選單或設定頁切換。
- 透過完整重新啟動 Codex，讓帳號變更生效。
- 跟隨系統語言，或從 65 種介面語言中選擇，包含英文與繁體中文。
- 支援 Codex 與相容的整合版 ChatGPT 桌面程式。
- 透過本機 Chromium DevTools Protocol（CDP）連線，在執行時加入帳號介面，
  不會修改或重新簽署已安裝的桌面程式。

## 畫面預覽

以下為使用範例帳號（`@example.com`）製作的示意畫面。
Codex 周邊介面可能隨桌面程式版本而不同。

### 啟動器

![Codex Account Switcher 啟動器](docs/screenshots/launcher-mockup.png)

### 帳號設定頁

![Codex 內的帳號設定頁](docs/screenshots/codex-accounts-mockup.png)

### 個人選單

![Codex 個人選單內的帳號切換介面](docs/screenshots/codex-menu-mockup.png)

## 安全性與本機資料

帳號快照與備份包含明文登入憑證。工具會將憑證資料夾與檔案的權限限制為
僅擁有者可存取；請妥善保護 macOS 使用者帳號與備份。

Bridge 僅監聽 localhost，並拒絕跨站控制請求。
CDP 偵錯連線能高度存取正在執行的程式，因此本機程序仍位於信任範圍內。
要結束偵錯工作階段，請停止 bridge 並結束 Codex。

| 位置 | 內容 |
| --- | --- |
| `~/.codex/auth.json` | Codex 目前使用的登入資料 |
| `~/.codex/auth_accounts/<name>.json` | 已儲存的帳號快照 |
| `~/.codex/current_account` | 目前帳號名稱 |
| `~/.codex/auth_accounts_usage.json` | 帳號用量快取 |
| `~/.codex/auth.account-switcher-backup-*.json` | 清除目前登入時建立的憑證備份 |
| `~/Library/Application Support/codex-account-switcher/` | Bridge 紀錄、偏好設定與執行狀態 |

帳號資料格式相容於 Codex++ 帳號切換器。完整說明請參閱
[SECURITY.md](SECURITY.md) 與
[公開前資安檢查紀錄](docs/security-review-2026-10-20.md)。
回報漏洞請使用
[私密漏洞回報](https://github.com/irons163/codex-desktop-switcher/security/advisories/new)。

## 建置與測試

開發環境需要含 macOS SDK 的 Swift 6 工具鏈，以及 Node.js 22 或更新版本。

```sh
git clone https://github.com/irons163/codex-desktop-switcher.git
cd codex-desktop-switcher
npm ci
swift test
npm test
npm run check
swift build
.build/debug/CodexAccountSwitcher --status-json
```

建置並驗證可直接開啟的 App：

```sh
scripts/package-app.sh
scripts/verify-app.sh
open dist/CodexAccountSwitcher.app
```

本機套件預設使用 ad-hoc 簽名。可用 `TARGET_ARCH=arm64` 或
`TARGET_ARCH=x86_64` 選擇處理器架構。需要正式散布簽名時，
將 `CODE_SIGN_IDENTITY` 設定為 Developer ID Application 憑證名稱。
驗證時會執行 App，因此 `scripts/verify-app.sh` 必須在對應架構的 Mac 上執行。

可使用 `node --test test/<suite>.test.js` 執行單一 Node 測試組。
CI 會分別在原生 Apple Silicon 與 Intel runner 測試、驗證 App，
並掃描完整 Git 歷史是否包含秘密資料。

### 命令列

使用 `.build/debug/CodexAccountSwitcher` 搭配下列選項：

| 選項 | 動作 |
| --- | --- |
| `--status-json` | 以 JSON 回報程式、bridge 與注入狀態 |
| `--launch` | 啟動 Codex 並注入帳號介面 |
| `--inject` | 連接既有的 Codex 偵錯工作階段並注入介面 |
| `--stop` | 停止切換器的 bridge |

仍支援舊版命令別名：`--install` 對應 `--launch`、
`--repair --quiet` 對應 `--inject --quiet`、`--uninstall` 對應 `--stop`。
