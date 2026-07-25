"use strict";

(() => {
  if (typeof window.__codexAccountSwitcherCleanup === "function") {
    try {
      window.__codexAccountSwitcherCleanup();
    } catch (error) {
      console.warn("[Codex Account Switcher] previous runtime cleanup failed", error);
    }
  }

  window.__codexAccountSwitcherInstalled = true;

  const accountPanelAttribute = "data-codex-account-switcher-panel";
  const styleAttribute = "data-codex-account-switcher-style";
  const settingsGroupAttribute = "data-codex-account-switcher-settings-group";
  const settingsEntryAttribute = "data-codex-account-switcher-settings-entry";
  const settingsPageAttribute = "data-codex-account-switcher-settings-page";
  const settingsContentHostAttribute = "data-codex-account-switcher-settings-content-host";
  const commandAttribute = "data-codex-account-switcher-command";
  const commandAccountAttribute = "data-codex-account-switcher-account";

  const MESSAGE_CATALOG = window.__codexAccountSwitcherMessages || { en: {} };
  const INHERIT_LOCALE = {
    "zh-HK": "zh-TW",
    "es-419": "es-ES",
    "fr-CA": "fr-FR",
    "pt-PT": "pt-BR",
    "nb-NO": "da-DK",
  };
  const LEGACY_TAGS = {
    "zh-Hant": "zh-TW",
    "zh-Hans": "zh-CN",
    no: "nb-NO",
    "no-NO": "nb-NO",
    nb: "nb-NO",
  };
  const SUPPORTED_LOCALES = ["auto", ...Object.keys(MESSAGE_CATALOG).sort((a, b) => a.localeCompare(b))];

  let languagePreference = "auto";

  function normalizeLocaleTag(tag) {
    if (!tag || typeof tag !== "string") return "";
    const trimmed = tag.trim();
    if (!trimmed) return "";
    if (LEGACY_TAGS[trimmed]) return LEGACY_TAGS[trimmed];
    const parts = trimmed.split("-").filter(Boolean);
    if (!parts.length) return "";
    if (parts.length === 1) return parts[0].toLowerCase();
    const [language, ...rest] = parts;
    const normalizedRest = rest.map((part) => {
      if (part.length === 2) return part.toUpperCase();
      if (part.length === 4) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
      return part;
    });
    const candidate = [language.toLowerCase(), ...normalizedRest].join("-");
    return LEGACY_TAGS[candidate] || candidate;
  }

  function resolveLocaleTag(tag) {
    const normalized = normalizeLocaleTag(tag);
    if (!normalized) return "en";
    if (MESSAGE_CATALOG[normalized]) return normalized;
    const inherited = INHERIT_LOCALE[normalized];
    if (inherited && MESSAGE_CATALOG[inherited]) return inherited;
    const language = normalized.split("-")[0];
    const regional = Object.keys(MESSAGE_CATALOG).find((locale) => locale.toLowerCase().startsWith(`${language.toLowerCase()}-`));
    return regional || "en";
  }

  function resolveLocale(preference = languagePreference) {
    if (!preference || preference === "auto") {
      return resolveLocaleTag(navigator.language || "en");
    }
    return resolveLocaleTag(preference);
  }

  function lookupMessage(locale, key) {
    const direct = MESSAGE_CATALOG[locale]?.[key];
    if (direct != null) return direct;
    const inherited = INHERIT_LOCALE[locale];
    if (inherited && MESSAGE_CATALOG[inherited]?.[key] != null) {
      return MESSAGE_CATALOG[inherited][key];
    }
    return MESSAGE_CATALOG.en?.[key] || key;
  }

  const t = (key) => lookupMessage(resolveLocale(), key);

  function localeDisplayName(code) {
    if (code === "auto") return t("languageAuto");
    try {
      const display = new Intl.DisplayNames([resolveLocale()], { type: "language" });
      return display.of(code) || code;
    } catch {
      return code;
    }
  }

  async function refreshLanguagePreference() {
    const result = await invoke({ action: "preferences" });
    if (result.ok && result.preferences?.language) {
      languagePreference = result.preferences.language;
    }
  }
  const pending = new Map();
  let nextId = 1;
  let observer = null;
  let scheduledFrame = 0;
  let nativeSettingsPageRoot = null;
  let nativeSettingsContentHost = null;
  let nativeSettingsContentStash = null;
  let activeNativeLoginAbortController = null;
  const assetModuleCache = new Map();

  window.__codexAccountSwitcherReceive = (id, payload) => {
    const resolver = pending.get(id);
    if (!resolver) return;
    pending.delete(id);
    resolver(payload);
  };

  function invoke(message) {
    if (typeof window.__codexAccountSwitcherBridge !== "function") {
      return Promise.resolve({ ok: false, error: { message: t("bridgeOffline") } });
    }
    const id = String(nextId++);
    return new Promise((resolve) => {
      pending.set(id, resolve);
      window.__codexAccountSwitcherBridge(JSON.stringify({ id, message }));
      window.setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        resolve({ ok: false, error: { message: t("bridgeOffline") } });
      }, 5000);
    });
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function codexAssetScriptUrls() {
    const urls = new Set();
    for (const script of Array.from(document.scripts || [])) {
      if (script.src) urls.add(new URL(script.src, document.baseURI).href);
    }
    try {
      for (const entry of performance.getEntriesByType("resource")) {
        if (entry?.name) urls.add(new URL(entry.name, document.baseURI).href);
      }
    } catch {}
    return Array.from(urls)
      .filter((url) => /\/(?:webview\/)?assets\/.+\.js(?:$|\?)/.test(url))
      .sort((a, b) => {
        const aMain = /\/(?:app-main|index)-/.test(a) ? 0 : 1;
        const bMain = /\/(?:app-main|index)-/.test(b) ? 0 : 1;
        return aMain - bMain || a.localeCompare(b);
      });
  }

  function codexAssetBaseUrl() {
    return codexAssetScriptUrls()[0] || new URL("/assets/index.js", window.location.href).href;
  }

  async function findBundledCodexAssetModule(modulePrefix) {
    const result = await invoke({ action: "find-codex-asset", prefix: modulePrefix });
    if (!result.ok || !result.asset?.fileName) return null;
    return new URL(`./${result.asset.fileName}`, codexAssetBaseUrl()).href;
  }

  async function findCodexAssetModule(modulePrefix) {
    if (assetModuleCache.has(modulePrefix)) return assetModuleCache.get(modulePrefix);
    const pattern = new RegExp(`${escapeRegExp(`./${modulePrefix}`)}[^"'\\\\]+\\.js`);
    for (const scriptUrl of codexAssetScriptUrls()) {
      let source = "";
      try {
        const response = await fetch(scriptUrl);
        if (!response.ok) continue;
        source = await response.text();
      } catch {
        continue;
      }
      const match = source.match(pattern);
      if (!match) continue;
      const moduleUrl = new URL(match[0], scriptUrl).href;
      assetModuleCache.set(modulePrefix, moduleUrl);
      return moduleUrl;
    }
    const bundledModuleUrl = await findBundledCodexAssetModule(modulePrefix);
    if (bundledModuleUrl) {
      assetModuleCache.set(modulePrefix, bundledModuleUrl);
      return bundledModuleUrl;
    }
    throw new Error(t("nativeLoginUnavailable"));
  }

  async function getCodexNativeChatGptLogin() {
    const modulePrefixes = [
      "chatgpt-desktop-auth-url-",
      "onboarding-login-content-",
    ];
    for (const modulePrefix of modulePrefixes) {
      try {
        const moduleUrl = await findCodexAssetModule(modulePrefix);
        const loginModule = await import(moduleUrl);
        const startLogin = Object.values(loginModule).find((value) =>
          typeof value === "function"
          && /login-with-chatgpt/.test(Function.prototype.toString.call(value))
        );
        if (startLogin) return startLogin;
        if (modulePrefix === "onboarding-login-content-" && typeof loginModule.r === "function") {
          return loginModule.r;
        }
      } catch {}
    }
    throw new Error(t("nativeLoginUnavailable"));
  }

  async function switchSavedAccount(name) {
    const result = await invoke({ action: "switch", name, relaunch: true });
    if (!result.ok) throw new Error(result.error?.message || "Switch failed");
    return result;
  }

  async function openNativeLoginAuthUrl(loginResult) {
    const authUrl = loginResult?.authUrl || loginResult?.auth_url;
    if (!authUrl) throw new Error(t("missingAuthUrl"));
    const opened = await invoke({ action: "open-url", url: authUrl });
    if (!opened.ok) throw new Error(opened.error?.message || "Open login URL failed");
    return opened;
  }

  function clearNativeLoginControllerWhenDone(controller, completion) {
    if (!completion || typeof completion.finally !== "function") return;
    completion.finally(() => {
      if (activeNativeLoginAbortController === controller) activeNativeLoginAbortController = null;
    }).catch(() => {});
  }

  async function startNewSignInWithNativeLogin() {
    const startLogin = await getCodexNativeChatGptLogin();
    if (activeNativeLoginAbortController) activeNativeLoginAbortController.abort();
    const controller = new AbortController();
    activeNativeLoginAbortController = controller;
    let loginResult;
    try {
      loginResult = await startLogin({
        signal: controller.signal,
        useStreamlinedLogin: false,
      });
    } catch (error) {
      if (/already in progress/i.test(error?.message || String(error))) {
        throw new Error(t("loginAlreadyInProgress"));
      }
      throw error;
    }
    clearNativeLoginControllerWhenDone(controller, loginResult?.completion);
    const result = await invoke({ action: "start-login", relaunch: false });
    if (!result.ok) {
      controller.abort();
      throw new Error(result.error?.message || "Start login failed");
    }
    try {
      await openNativeLoginAuthUrl(loginResult);
    } catch (error) {
      controller.abort();
      throw error;
    }
    return result;
  }

  function compactText(element) {
    return (element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function exactText(element, expected) {
    return compactText(element) === expected;
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function installStyles() {
    document.querySelectorAll(`[${styleAttribute}]`).forEach((node) => node.remove());
    const style = document.createElement("style");
    style.setAttribute(styleAttribute, "true");
    style.textContent = `
      [${settingsGroupAttribute}] {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 12px;
      }
      [${settingsGroupAttribute}] .codex-account-switcher-group-label {
        color: var(--color-token-text-secondary, currentColor);
        font-size: 11px;
        padding: 8px 12px 4px;
      }
      [${settingsEntryAttribute}] {
        cursor: pointer;
      }
      [${settingsPageAttribute}] {
        box-sizing: border-box;
        display: flex;
        width: 100%;
        min-height: 100%;
        flex-direction: column;
        gap: 18px;
        padding: 4px 2px 24px;
      }
      .codex-account-switcher-page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .codex-account-switcher-title {
        color: var(--color-token-text-primary, currentColor);
        font-size: 18px;
        font-weight: 600;
      }
      .codex-account-switcher-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .codex-account-switcher-section-title {
        color: var(--color-token-text-secondary, currentColor);
        font-size: 12px;
        font-weight: 600;
      }
      .codex-account-switcher-panel {
        background: var(--color-background-panel, var(--color-token-bg-fog, color-mix(in srgb, currentColor 7%, transparent)));
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .codex-account-switcher-row {
        align-items: center;
        display: flex;
        gap: 12px;
        justify-content: space-between;
        padding: 12px;
      }
      .codex-account-switcher-row + .codex-account-switcher-row {
        border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent);
      }
      .codex-account-switcher-main {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        gap: 3px;
      }
      .codex-account-switcher-primary {
        color: var(--color-token-text-primary, currentColor);
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .codex-account-switcher-secondary {
        color: var(--color-token-text-secondary, currentColor);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .codex-account-switcher-actions {
        display: flex;
        flex-shrink: 0;
        gap: 8px;
      }
      .codex-account-switcher-action {
        align-items: center;
        background: color-mix(in srgb, currentColor 9%, transparent);
        border: 0;
        border-radius: 7px;
        color: var(--color-token-text-primary, currentColor);
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: 13px;
        justify-content: center;
        min-height: 30px;
        padding: 0 10px;
      }
      .codex-account-switcher-action:hover {
        background: color-mix(in srgb, currentColor 14%, transparent);
      }
      .codex-account-switcher-action:disabled {
        cursor: default;
        opacity: 0.45;
      }
      .codex-account-switcher-status {
        color: var(--color-token-text-secondary, currentColor);
        font-size: 12px;
        min-height: 16px;
      }
      .codex-account-switcher-status[data-error="true"] {
        color: #ff6b6b;
      }
    `;
    document.head.appendChild(style);
  }

  function menuButton(label, action) {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.style.cssText = [
      "width:100%",
      "border:0",
      "background:transparent",
      "color:var(--color-token-text-primary,currentColor)",
      "font:inherit",
      "font-size:13px",
      "text-align:left",
      "border-radius:8px",
      "padding:5px 8px",
      "cursor:pointer",
    ].join(";");
    item.addEventListener("mouseenter", () => {
      item.style.background = "color-mix(in srgb,currentColor 8%,transparent)";
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "transparent";
    });
    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      item.disabled = true;
      Promise.resolve(action()).catch((error) => {
        console.warn("[Codex Account Switcher] menu action failed", error);
        item.textContent = error?.message || String(error);
        item.style.color = "#ff6b6b";
      }).finally(() => {
        if (item.isConnected) item.disabled = false;
      });
    });
    return item;
  }

  async function renderPanel(panel) {
    panel.textContent = "";
    panel.style.cssText = "display:flex;flex-direction:column;gap:3px;padding:6px 12px;border-top:1px solid color-mix(in srgb,currentColor 12%,transparent);";
    await refreshLanguagePreference();
    const heading = document.createElement("div");
    heading.textContent = t("title");
    heading.style.cssText = "font-size:12px;color:var(--color-token-text-secondary,currentColor);padding:2px 8px;";
    panel.appendChild(heading);

    const result = await invoke({ action: "state" });
    if (!result.ok) {
      const error = document.createElement("div");
      error.textContent = result.error?.message || "Account switcher failed";
      error.style.cssText = "font-size:12px;color:#ff6b6b;padding:4px 8px;";
      panel.appendChild(error);
      return;
    }
    const state = result.state;
    if (!state.accounts.length) {
      const empty = document.createElement("div");
      empty.textContent = state.hasActiveAuth ? t("emptySaved") : t("emptyActive");
      empty.style.cssText = "font-size:12px;color:var(--color-token-text-secondary,currentColor);padding:4px 8px;";
      panel.appendChild(empty);
    }
    for (const name of state.accounts) {
      const label = `${state.accountEmails[name] || name}${state.current === name ? ` (${t("current")})` : ""}`;
      panel.appendChild(menuButton(label, async () => {
        panel.textContent = t("switching");
        const switchResult = await switchSavedAccount(name);
        if (switchResult.state?.requiresAppRelaunch) panel.textContent = t("relaunching");
        else await renderPanel(panel);
      }));
    }
    panel.appendChild(menuButton(t("save"), async () => {
      const name = window.prompt(t("accountName"));
      if (!name) return;
      panel.textContent = t("loading");
      const saveResult = await invoke({ action: "save", name });
      if (!saveResult.ok) throw new Error(saveResult.error?.message || "Save failed");
      await renderPanel(panel);
    }));
    panel.appendChild(menuButton(t("newSignIn"), async () => {
      panel.textContent = t("openingSignIn");
      await startNewSignInWithNativeLogin();
      panel.textContent = t("newSignInDone");
    }));
    panel.appendChild(menuButton(t("configure"), () => openAccountsSettings()));
  }

  function accountMenuScore(candidate) {
    if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) return -1;
    const text = Array.from(candidate.querySelectorAll('[role="menuitem"]'))
      .filter((item) => !item.closest(`[${accountPanelAttribute}]`))
      .map((item) => compactText(item))
      .join(" ");
    const hasEmail = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text);
    const hasSettings = /\bsettings\b/i.test(text) || /設定/.test(text);
    const hasLogout = /\blog out\b|\bsign out\b/i.test(text) || /登出/.test(text);
    const hasUsage = /\busage remaining\b|\brate limits?\b/i.test(text) || /用量|額度/.test(text);
    if (!hasEmail && !(hasSettings && hasLogout) && !hasUsage) return -1;
    let score = 0;
    if (candidate.matches('[role="menu"]')) score += 5;
    if (candidate.matches("[data-radix-menu-content]")) score += 5;
    if (hasEmail) score += 50;
    if (hasSettings) score += 20;
    if (hasLogout) score += 30;
    if (hasUsage) score += 20;
    return score;
  }

  function findAccountMenu() {
    const candidates = Array.from(document.querySelectorAll('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'))
      .map((candidate) => {
        if (!(candidate instanceof HTMLElement)) return null;
        if (candidate.matches("[data-radix-popper-content-wrapper]")) {
          return candidate.querySelector('[role="menu"], [data-radix-menu-content]') || candidate;
        }
        return candidate;
      })
      .filter(Boolean);
    return candidates.sort((a, b) => accountMenuScore(b) - accountMenuScore(a))[0] || null;
  }

  function installAccountPanel() {
    const menu = findAccountMenu();
    if (!(menu instanceof HTMLElement) || accountMenuScore(menu) < 30) return;
    if (menu.querySelector(`[${accountPanelAttribute}]`)) return;
    const panel = document.createElement("div");
    panel.setAttribute(accountPanelAttribute, "true");
    const first = menu.firstElementChild;
    if (first) first.before(panel);
    else menu.appendChild(panel);
    renderPanel(panel).catch((error) => {
      panel.textContent = error.message || String(error);
    });
  }

  function openAccountsSettings() {
    const settingsItem = Array.from(document.querySelectorAll("button, [role='menuitem'], a"))
      .find((element) => element instanceof HTMLElement && /settings|設定/i.test(compactText(element)));
    if (settingsItem instanceof HTMLElement) settingsItem.click();

    let attempts = 0;
    const attempt = () => {
      installNativeAccountsSettingsGroup();
      if (openNativeAccountsSettingsPage()) return;
      if (attempts++ < 12) window.setTimeout(attempt, 200);
    };
    window.setTimeout(attempt, 250);
  }

  function settingsSignals(text) {
    const english = ["Back to app", "General", "Appearance", "Configuration", "Personalization"];
    const zh = ["返回", "一般", "外觀", "設定", "個人化"];
    const englishScore = english.filter((item) => text.includes(item)).length;
    const zhScore = zh.filter((item) => text.includes(item)).length;
    return { englishScore, zhScore };
  }

  function isCodexSettingsSidebarCandidate(sidebar) {
    if (!(sidebar instanceof HTMLElement) || !isVisible(sidebar)) return false;
    const text = compactText(sidebar);
    const { englishScore, zhScore } = settingsSignals(text);
    return englishScore >= 4 || (text.includes("Back to app") && englishScore >= 3) || zhScore >= 3;
  }

  function findCodexSettingsSidebar() {
    const selector = "aside, nav, [role='navigation'], [role='tablist']";
    return Array.from(document.querySelectorAll(selector)).find((node) =>
      isCodexSettingsSidebarCandidate(node),
    ) || null;
  }

  function nativeSettingsClickableSelector() {
    return "button, a, [role='button'], [role='tab'], [role='menuitem']";
  }

  function findClickableSettingsItem(sidebar, label) {
    if (!(sidebar instanceof HTMLElement)) return null;
    return Array.from(sidebar.querySelectorAll(nativeSettingsClickableSelector())).find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.closest(`[${settingsGroupAttribute}]`)) return false;
      if (!exactText(node, label)) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 40 && rect.height > 12;
    }) || null;
  }

  function setNativeSettingsEntryLabel(entry, label) {
    const leaves = Array.from(entry.querySelectorAll("*")).filter((node) =>
      node instanceof HTMLElement && !node.children.length && compactText(node),
    );
    const labelNode = leaves.find((node) => /Configuration|General|Appearance|Personalization/.test(compactText(node))) || leaves[leaves.length - 1];
    if (labelNode instanceof HTMLElement) labelNode.textContent = label;
    else entry.textContent = label;
  }

  function accountIconSvg() {
    return `<svg data-codex-account-switcher-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
  }

  function setNativeSettingsEntryIcon(entry) {
    const wrapper = document.createElement("span");
    wrapper.innerHTML = accountIconSvg();
    const icon = wrapper.firstElementChild;
    if (!(icon instanceof SVGElement)) return;
    const current = entry.querySelector("svg");
    if (current instanceof SVGElement) current.replaceWith(icon);
    else entry.insertBefore(icon, entry.firstChild);
  }

  function cloneNativeSettingsEntry(sidebar) {
    const template = findClickableSettingsItem(sidebar, "Configuration") || findClickableSettingsItem(sidebar, "General");
    const entry = template?.cloneNode(true);
    if (!(entry instanceof HTMLElement)) return null;
    entry.setAttribute(settingsEntryAttribute, "accounts");
    entry.removeAttribute("id");
    entry.removeAttribute("aria-current");
    entry.removeAttribute("aria-selected");
    entry.removeAttribute("data-state");
    entry.removeAttribute("data-active");
    entry.removeAttribute("data-highlighted");
    entry.setAttribute("tabindex", "0");
    setNativeSettingsEntryLabel(entry, t("settingsTitle"));
    setNativeSettingsEntryIcon(entry);
    return entry;
  }

  function cloneNativeSettingsGroupLabel(sidebar) {
    const hostText = Array.from(sidebar.querySelectorAll("*")).find((node) =>
      node instanceof HTMLElement && exactText(node, "Host") && isVisible(node),
    );
    const label = hostText?.cloneNode(true);
    if (label instanceof HTMLElement) {
      label.textContent = t("settingsGroup");
      label.removeAttribute("id");
      label.removeAttribute("aria-current");
      label.removeAttribute("aria-selected");
      label.removeAttribute("data-state");
      return label;
    }
    const fallback = document.createElement("div");
    fallback.className = "codex-account-switcher-group-label";
    fallback.textContent = t("settingsGroup");
    return fallback;
  }

  function createNativeSettingsGroup(sidebar) {
    const entry = cloneNativeSettingsEntry(sidebar);
    if (!(entry instanceof HTMLElement)) return null;
    const group = document.createElement("div");
    group.setAttribute(settingsGroupAttribute, "true");
    group.appendChild(cloneNativeSettingsGroupLabel(sidebar));
    group.appendChild(entry);
    return group;
  }

  function installNativeAccountsSettingsGroup() {
    const sidebar = findCodexSettingsSidebar();
    if (!(sidebar instanceof HTMLElement)) return false;
    if (sidebar.querySelector(`[${settingsGroupAttribute}]`)) return true;
    const group = createNativeSettingsGroup(sidebar);
    if (!(group instanceof HTMLElement)) return false;
    sidebar.appendChild(group);
    return true;
  }

  function updateNativeSettingsActiveEntry(active) {
    for (const entry of document.querySelectorAll(`[${settingsEntryAttribute}]`)) {
      if (!(entry instanceof HTMLElement)) continue;
      entry.setAttribute("data-active", active ? "true" : "false");
      entry.setAttribute("aria-selected", active ? "true" : "false");
      if (active) entry.setAttribute("aria-current", "page");
      else entry.removeAttribute("aria-current");
    }
  }

  function nativeSettingsContentRootScore(root, sidebarRect) {
    const rect = root.getBoundingClientRect();
    const style = window.getComputedStyle(root);
    const className = String(root.className || "");
    let score = rect.width * rect.height;
    if (rect.left >= sidebarRect.right - 8) score += 1_000_000_000;
    if (className.includes("p-panel")) score += 20_000;
    if (className.includes("scrollbar-stable")) score += 10_000;
    if (style.overflowY === "auto" || style.overflowY === "scroll") score += 5_000;
    return score;
  }

  function isValidNativeSettingsContentRoot(root, sidebar, sidebarRect) {
    if (!(root instanceof HTMLElement) || !isVisible(root)) return false;
    if (root.contains(sidebar) || sidebar.contains(root)) return false;
    if (root.closest(`[${settingsGroupAttribute}]`)) return false;
    if (root.querySelector(`[${settingsEntryAttribute}]`)) return false;
    const rect = root.getBoundingClientRect();
    return rect.left >= sidebarRect.right - 8;
  }

  function isValidNativeSettingsScrollContentRoot(root, sidebar, sidebarRect) {
    if (!isValidNativeSettingsContentRoot(root, sidebar, sidebarRect)) return false;
    const style = window.getComputedStyle(root);
    const className = String(root.className || "");
    return className.includes("p-panel") || className.includes("scrollbar-stable") || style.overflowY === "auto" || style.overflowY === "scroll";
  }

  function findNativeSettingsScrollContentRoot(root, sidebar, sidebarRect) {
    return Array.from(root.querySelectorAll("div, main, section"))
      .filter((candidate) => isValidNativeSettingsScrollContentRoot(candidate, sidebar, sidebarRect))
      .sort((a, b) => nativeSettingsContentRootScore(b, sidebarRect) - nativeSettingsContentRootScore(a, sidebarRect))[0] || null;
  }

  function findNativeSettingsContentRoot(sidebar) {
    if (!(sidebar instanceof HTMLElement)) return null;
    const sidebarRect = sidebar.getBoundingClientRect();
    for (
      let ancestor = sidebar.parentElement;
      ancestor instanceof HTMLElement;
      ancestor = ancestor === document.body ? null : ancestor.parentElement
    ) {
      const root = Array.from(ancestor.children)
        .filter((child) => child instanceof HTMLElement && !child.contains(sidebar))
        .filter((candidate) => isValidNativeSettingsContentRoot(candidate, sidebar, sidebarRect))
        .sort((a, b) => nativeSettingsContentRootScore(b, sidebarRect) - nativeSettingsContentRootScore(a, sidebarRect))[0];
      if (root instanceof HTMLElement) {
        return findNativeSettingsScrollContentRoot(root, sidebar, sidebarRect) || root;
      }
    }
    return null;
  }

  function stashNativeSettingsContent(host) {
    if (!(host instanceof HTMLElement)) return;
    if (nativeSettingsContentStash?.host === host) return;
    restoreNativeSettingsContent();
    const marker = document.createComment("codex-account-switcher-native-settings-stash");
    const fragment = document.createDocumentFragment();
    host.insertBefore(marker, host.firstChild);
    for (const node of Array.from(host.childNodes)) {
      if (node === marker) continue;
      if (node instanceof HTMLElement && node.hasAttribute(settingsPageAttribute)) continue;
      fragment.appendChild(node);
    }
    nativeSettingsContentStash = { host, marker, fragment };
  }

  function restoreNativeSettingsContent() {
    if (!nativeSettingsContentStash) return;
    const { host, marker, fragment } = nativeSettingsContentStash;
    if (host instanceof HTMLElement && marker instanceof Comment && marker.parentNode === host) {
      host.insertBefore(fragment, marker.nextSibling);
      marker.remove();
    }
    nativeSettingsContentStash = null;
  }

  function clearNativeAccountsSettingsPage() {
    document.querySelectorAll(`[${settingsPageAttribute}]`).forEach((node) => node.remove());
    restoreNativeSettingsContent();
    document.querySelectorAll(`[${settingsContentHostAttribute}]`).forEach((node) => {
      node.removeAttribute(settingsContentHostAttribute);
    });
    nativeSettingsPageRoot = null;
    nativeSettingsContentHost = null;
    updateNativeSettingsActiveEntry(false);
  }

  function commandButton(label, command, account = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "codex-account-switcher-action";
    button.textContent = label;
    button.setAttribute(commandAttribute, command);
    if (account) button.setAttribute(commandAccountAttribute, account);
    return button;
  }

  function pageSection(titleText) {
    const section = document.createElement("section");
    section.className = "codex-account-switcher-section";
    const title = document.createElement("div");
    title.className = "codex-account-switcher-section-title";
    title.textContent = titleText;
    section.appendChild(title);
    return section;
  }

  function setStatus(page, message, isError = false) {
    const status = page?.querySelector("[data-codex-account-switcher-status]");
    if (!(status instanceof HTMLElement)) return;
    status.textContent = message || "";
    status.setAttribute("data-error", isError ? "true" : "false");
  }

  function setPageButtonsDisabled(page, disabled) {
    if (!(page instanceof HTMLElement)) return;
    for (const button of page.querySelectorAll(`[${commandAttribute}]`)) {
      if (button instanceof HTMLButtonElement) button.disabled = disabled;
    }
  }

  function activeAccountLabel(state) {
    if (state.current) return state.accountEmails[state.current] || state.current;
    return state.hasActiveAuth ? t("unsavedActive") : t("emptyActive");
  }

  function renderAccountsState(page, state) {
    const activeValue = page.querySelector("[data-codex-account-switcher-active]");
    if (activeValue instanceof HTMLElement) activeValue.textContent = activeAccountLabel(state);

    const list = page.querySelector("[data-codex-account-switcher-list]");
    if (!(list instanceof HTMLElement)) return;
    list.textContent = "";

    if (!state.accounts.length) {
      const empty = document.createElement("div");
      empty.className = "codex-account-switcher-row";
      const text = document.createElement("div");
      text.className = "codex-account-switcher-secondary";
      text.textContent = t("noAccounts");
      empty.appendChild(text);
      list.appendChild(empty);
      return;
    }

    for (const name of state.accounts) {
      const row = document.createElement("div");
      row.className = "codex-account-switcher-row";

      const main = document.createElement("div");
      main.className = "codex-account-switcher-main";
      const primary = document.createElement("div");
      primary.className = "codex-account-switcher-primary";
      primary.textContent = state.accountEmails[name] || name;
      const secondary = document.createElement("div");
      secondary.className = "codex-account-switcher-secondary";
      secondary.textContent = state.current === name ? `${name} · ${t("current")}` : name;
      main.appendChild(primary);
      main.appendChild(secondary);

      const actions = document.createElement("div");
      actions.className = "codex-account-switcher-actions";
      const switchButton = commandButton(t("switch"), "switch", name);
      if (state.current === name) switchButton.disabled = true;
      actions.appendChild(switchButton);
      actions.appendChild(commandButton(t("delete"), "delete", name));

      row.appendChild(main);
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  async function refreshNativeAccountsSettingsPage(page) {
    if (!(page instanceof HTMLElement)) return;
    await refreshLanguagePreference();
    setStatus(page, t("loading"));
    const result = await invoke({ action: "state" });
    if (!page.isConnected) return;
    if (!result.ok) {
      setStatus(page, result.error?.message || "Account switcher failed", true);
      return;
    }
    renderAccountsState(page, result.state);
    setStatus(page, t("ready"));
  }

  async function renderNativeAccountsSettingsPage(host) {
    if (!(host instanceof HTMLElement)) return null;
    await refreshLanguagePreference();
    host.querySelectorAll(`[${settingsPageAttribute}]`).forEach((node) => node.remove());
    stashNativeSettingsContent(host);
    host.setAttribute(settingsContentHostAttribute, "true");

    const page = document.createElement("section");
    page.setAttribute(settingsPageAttribute, "accounts");

    const header = document.createElement("div");
    header.className = "codex-account-switcher-page-header";
    const title = document.createElement("div");
    title.className = "codex-account-switcher-title";
    title.textContent = t("settingsTitle");
    const headerActions = document.createElement("div");
    headerActions.className = "codex-account-switcher-actions";
    headerActions.appendChild(commandButton(t("refresh"), "refresh"));
    header.appendChild(title);
    header.appendChild(headerActions);

    const activeSection = pageSection(t("activeAccount"));
    const activePanel = document.createElement("div");
    activePanel.className = "codex-account-switcher-panel";
    const activeRow = document.createElement("div");
    activeRow.className = "codex-account-switcher-row";
    const activeMain = document.createElement("div");
    activeMain.className = "codex-account-switcher-main";
    const activeValue = document.createElement("div");
    activeValue.className = "codex-account-switcher-primary";
    activeValue.setAttribute("data-codex-account-switcher-active", "true");
    activeValue.textContent = t("loading");
    activeMain.appendChild(activeValue);
    const activeActions = document.createElement("div");
    activeActions.className = "codex-account-switcher-actions";
    activeActions.appendChild(commandButton(t("save"), "save"));
    activeActions.appendChild(commandButton(t("newSignIn"), "clear-active"));
    activeRow.appendChild(activeMain);
    activeRow.appendChild(activeActions);
    activePanel.appendChild(activeRow);
    activeSection.appendChild(activePanel);

    const accountsSection = pageSection(t("savedAccounts"));
    const accountsPanel = document.createElement("div");
    accountsPanel.className = "codex-account-switcher-panel";
    accountsPanel.setAttribute("data-codex-account-switcher-list", "true");
    accountsSection.appendChild(accountsPanel);

    const languageSection = pageSection(t("language"));
    const languagePanel = document.createElement("div");
    languagePanel.className = "codex-account-switcher-panel";
    languagePanel.style.maxHeight = "180px";
    languagePanel.style.overflowY = "auto";
    const languageActions = document.createElement("div");
    languageActions.className = "codex-account-switcher-actions";
    languageActions.style.flexWrap = "wrap";
    for (const code of SUPPORTED_LOCALES) {
      const button = commandButton(localeDisplayName(code), "language", code);
      if (languagePreference === code) button.disabled = true;
      languageActions.appendChild(button);
    }
    languagePanel.appendChild(languageActions);
    languageSection.appendChild(languagePanel);

    const status = document.createElement("div");
    status.className = "codex-account-switcher-status";
    status.setAttribute("data-codex-account-switcher-status", "true");
    status.textContent = t("loading");

    page.appendChild(header);
    page.appendChild(activeSection);
    page.appendChild(accountsSection);
    page.appendChild(languageSection);
    page.appendChild(status);
    host.appendChild(page);

    nativeSettingsPageRoot = page;
    nativeSettingsContentHost = host;
    updateNativeSettingsActiveEntry(true);
    refreshNativeAccountsSettingsPage(page).catch((error) => {
      setStatus(page, error.message || String(error), true);
    });
    return page;
  }

  function openNativeAccountsSettingsPage() {
    const sidebar = findCodexSettingsSidebar();
    if (!(sidebar instanceof HTMLElement)) return false;
    const contentRoot = findNativeSettingsContentRoot(sidebar);
    if (!(contentRoot instanceof HTMLElement)) return false;
    renderNativeAccountsSettingsPage(contentRoot).catch((error) => {
      console.warn("[Codex Account Switcher] settings page failed", error);
    });
    return true;
  }

  function installDialogSettingsFallback() {
    if (findCodexSettingsSidebar()) return;
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
      .find((element) => element instanceof HTMLElement && /settings|設定/i.test(compactText(element)));
    if (!(dialog instanceof HTMLElement) || dialog.querySelector(`[${settingsPageAttribute}]`)) return;
    renderNativeAccountsSettingsPage(dialog).then((panel) => {
      if (panel instanceof HTMLElement) panel.style.padding = "16px";
    }).catch((error) => {
      console.warn("[Codex Account Switcher] dialog settings failed", error);
    });
  }

  async function handleAccountCommand(target) {
    if (!(target instanceof HTMLElement)) return;
    const command = target.getAttribute(commandAttribute) || "";
    const page = target.closest(`[${settingsPageAttribute}]`) || nativeSettingsPageRoot;
    if (!(page instanceof HTMLElement)) return;

    try {
      setPageButtonsDisabled(page, true);
      if (command === "refresh") {
        await refreshNativeAccountsSettingsPage(page);
        return;
      }
      if (command === "language") {
        const language = target.getAttribute(commandAccountAttribute) || "auto";
        const result = await invoke({ action: "preferences", language });
        if (!result.ok) throw new Error(result.error?.message || "Language update failed");
        languagePreference = result.preferences.language;
        const host = nativeSettingsContentHost;
        if (host instanceof HTMLElement) {
          await renderNativeAccountsSettingsPage(host);
        }
        return;
      }
      if (command === "save") {
        const name = window.prompt(t("accountName"));
        if (!name) return;
        const result = await invoke({ action: "save", name });
        if (!result.ok) throw new Error(result.error?.message || "Save failed");
        renderAccountsState(page, result.state);
        setStatus(page, t("saveDone"));
        return;
      }
      if (command === "switch") {
        const name = target.getAttribute(commandAccountAttribute) || "";
        setStatus(page, t("switching"));
        const result = await switchSavedAccount(name);
        renderAccountsState(page, result.state);
        setStatus(page, result.state?.requiresAppRelaunch ? t("relaunching") : t("switchDone"));
        return;
      }
      if (command === "delete") {
        const name = target.getAttribute(commandAccountAttribute) || "";
        const result = await invoke({ action: "delete", name });
        if (!result.ok) throw new Error(result.error?.message || "Delete failed");
        renderAccountsState(page, result.state);
        setStatus(page, t("deleteDone"));
        return;
      }
      if (command === "clear-active") {
        setStatus(page, t("openingSignIn"));
        const result = await startNewSignInWithNativeLogin();
        renderAccountsState(page, result.state);
        setStatus(page, t("newSignInDone"));
      }
    } catch (error) {
      setStatus(page, error.message || String(error), true);
    } finally {
      if (page.isConnected) setPageButtonsDisabled(page, false);
    }
  }

  function isNativeSettingsNavigationClick(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(`[${settingsGroupAttribute}]`)) return false;
    const clickable = target.closest(nativeSettingsClickableSelector());
    if (!(clickable instanceof HTMLElement)) return false;
    const sidebar = findCodexSettingsSidebar();
    return sidebar instanceof HTMLElement && sidebar.contains(clickable);
  }

  function onDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const settingsEntry = target.closest(`[${settingsEntryAttribute}]`);
    if (settingsEntry instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openNativeAccountsSettingsPage();
      return;
    }

    const command = target.closest(`[${commandAttribute}]`);
    if (command instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handleAccountCommand(command);
      return;
    }

    if (nativeSettingsPageRoot && isNativeSettingsNavigationClick(target)) {
      clearNativeAccountsSettingsPage();
    }
  }

  function schedule() {
    if (scheduledFrame) return;
    scheduledFrame = window.setTimeout(() => {
      scheduledFrame = 0;
      installAccountPanel();
      installNativeAccountsSettingsGroup();
      installDialogSettingsFallback();
      if (nativeSettingsPageRoot && !nativeSettingsPageRoot.isConnected) clearNativeAccountsSettingsPage();
      if (nativeSettingsContentHost && !nativeSettingsContentHost.isConnected) clearNativeAccountsSettingsPage();
    }, 0);
  }

  function onPointerDown() {
    schedule();
  }

  function onKeyDown() {
    schedule();
  }

  function removeRuntimeEventListeners() {
    document.removeEventListener("click", onDocumentClick, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function cleanupInjectedDom() {
    clearNativeAccountsSettingsPage();
    document.querySelectorAll(`[${accountPanelAttribute}], [${settingsGroupAttribute}], [${styleAttribute}]`).forEach((node) => node.remove());
  }

  window.__codexAccountSwitcherCleanup = () => {
    if (scheduledFrame) {
      window.clearTimeout(scheduledFrame);
      scheduledFrame = 0;
    }
    if (observer) observer.disconnect();
    removeRuntimeEventListeners();
    cleanupInjectedDom();
    pending.clear();
    observer = null;
    nativeSettingsPageRoot = null;
    nativeSettingsContentHost = null;
    window.__codexAccountSwitcherInstalled = false;
    delete window.__codexAccountSwitcherReceive;
  };

  installStyles();
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["role", "aria-selected", "aria-current", "data-state", "class"],
  });
  schedule();
})();
