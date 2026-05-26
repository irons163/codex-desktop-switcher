const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  accountChooserURL,
  createAccountService,
  openAccountChooserURL,
} = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");
const {
  findCodexAssetByPrefix,
} = require("../Sources/CodexAccountSwitcher/Resources/runtime/account-service");
const {
  codexDebugArgs,
  codexLaunchArgs,
  codexMainProcessIds,
  codexPageTargets,
  chooseDebugPortForLaunch,
  findAvailablePort,
  pickCodexTarget,
  portIsAvailable,
  queryBridge,
  rendererInjectionSource,
} = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp");
const { cdpTargetNotReadyMessage } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge-server");

function auth(email, profile = email) {
  return JSON.stringify({
    auth_mode: "chatgpt",
    profile_id: profile,
    email,
    tokens: { access_token: "access", refresh_token: "refresh" },
  });
}

async function withTempHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-switcher-helper-"));
  try {
    return await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function writeAsarHeaderFixture(asarPath, header) {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(json.length + 9, 4);
  prefix.writeUInt32LE(json.length + 5, 8);
  prefix.writeUInt32LE(json.length, 12);
  await fs.writeFile(asarPath, Buffer.concat([prefix, json]));
}

test("account service saves, switches, deletes, and reports state", async () => {
  await withTempHome(async (home) => {
    const service = createAccountService({ home });
    const codexDir = path.join(home, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "auth.json"), auth("work@example.com", "work"));

    let result = await service.handle({ action: "save", name: "work" });
    assert.equal(result.ok, true);
    assert.equal(result.state.current, "work");

    await fs.writeFile(path.join(codexDir, "auth.json"), auth("me@example.com", "personal"));
    result = await service.handle({ action: "state" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accounts, ["account", "work"]);

    result = await service.handle({ action: "switch", name: "work" });
    assert.equal(result.ok, true);
    assert.equal(result.state.requiresAppRelaunch, true);
    assert.match(await fs.readFile(path.join(codexDir, "auth.json"), "utf8"), /work@example.com/);

    result = await service.handle({ action: "delete", name: "work" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.state.accounts, ["account"]);
  });
});

test("account service switch requests a real Codex restart by default", async () => {
  await withTempHome(async (home) => {
    const relaunches = [];
    const service = createAccountService({ home, relaunch: (options) => { relaunches.push(options); } });
    const codexDir = path.join(home, ".codex");
    const accountsDir = path.join(codexDir, "auth_accounts");
    await fs.mkdir(accountsDir, { recursive: true });
    await fs.writeFile(path.join(accountsDir, "work.json"), auth("work@example.com", "work"));

    const result = await service.handle({ action: "switch", name: "work" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(result.ok, true);
    assert.equal(result.state.requiresAppRelaunch, true);
    assert.deepEqual(relaunches, [{ forceRelaunch: true }]);
  });
});

test("account service starts a new login by preserving the active account first", async () => {
  await withTempHome(async (home) => {
    const service = createAccountService({ home });
    const codexDir = path.join(home, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "auth.json"), auth("first@example.com", "first"));

    const result = await service.handle({ action: "start-login" });

    assert.equal(result.ok, true);
    assert.equal(result.state.hasActiveAuth, false);
    assert.deepEqual(result.state.accounts, ["account"]);
    assert.equal(result.state.accountEmails.account, "first@example.com");
    await assert.rejects(() => fs.access(path.join(codexDir, "auth.json")));
    assert.match(await fs.readFile(path.join(codexDir, "auth_accounts", "account.json"), "utf8"), /first@example.com/);
  });
});

test("account login URL forces fresh auth without unsupported prompt values", () => {
  const rawUrl = "https://auth.openai.com/oauth/authorize?client_id=codex&prompt=none&state=abc";

  const url = new URL(accountChooserURL(rawUrl));

  assert.equal(url.origin, "https://auth.openai.com");
  assert.equal(url.searchParams.get("client_id"), "codex");
  assert.equal(url.searchParams.get("state"), "abc");
  assert.equal(url.searchParams.has("prompt"), false);
  assert.equal(url.searchParams.get("max_age"), "0");
});

test("account service opens Codex login URLs in fresh auth mode", async () => {
  await withTempHome(async (home) => {
    const opened = [];
    const service = createAccountService({
      home,
      openURL: async (url) => {
        opened.push(url);
      },
    });

    const result = await service.handle({
      action: "open-url",
      url: "https://auth.openai.com/oauth/authorize?client_id=codex",
    });

    assert.equal(result.ok, true);
    assert.equal(opened.length, 1);
    const openedUrl = new URL(opened[0]);
    assert.equal(openedUrl.searchParams.has("prompt"), false);
    assert.equal(openedUrl.searchParams.get("max_age"), "0");
    assert.equal(result.openedUrl, opened[0]);
  });
});

test("account chooser opener rejects non-http login URLs", async () => {
  await assert.rejects(
    () => openAccountChooserURL("file:///tmp/auth.json", async () => {}),
    /Only http\(s\) login URLs are supported/,
  );
});

test("account service finds Codex lazy asset chunks from the app asar header", async () => {
  await withTempHome(async (home) => {
    const codexApp = path.join(home, "Codex.app");
    const resources = path.join(codexApp, "Contents", "Resources");
    await fs.mkdir(resources, { recursive: true });
    await writeAsarHeaderFixture(path.join(resources, "app.asar"), {
      files: {
        webview: {
          files: {
            assets: {
              files: {
                "index-abc.js": { size: 0, offset: "0" },
                "onboarding-login-content-Bf2QVA6e.js": { size: 0, offset: "0" },
              },
            },
          },
        },
      },
    });

    const asset = await findCodexAssetByPrefix(codexApp, "onboarding-login-content-");
    assert.equal(asset.fileName, "onboarding-login-content-Bf2QVA6e.js");

    const service = createAccountService({ home, codexApp });
    const result = await service.handle({
      action: "find-codex-asset",
      prefix: "onboarding-login-content-",
    });
    assert.equal(result.ok, true);
    assert.equal(result.asset.fileName, "onboarding-login-content-Bf2QVA6e.js");
  });
});

test("helper status emits JSON error for missing Codex app", () => {
  const cli = path.join(__dirname, "..", "Sources", "CodexAccountSwitcher", "Resources", "cdp-helper", "cli.js");
  const result = spawnSync(process.execPath, [
    cli,
    "status",
    "--codex-app",
    path.join(os.tmpdir(), "does-not-exist-Codex.app"),
    "--user-root",
    os.tmpdir(),
    "--json",
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error.message, /Codex\.app not found/);
});

test("CDP launcher args enable local browser debugging without app patching", () => {
  assert.deepEqual(codexDebugArgs(57321), [
    "--remote-debugging-port=57321",
    "--remote-allow-origins=http://127.0.0.1:57321",
  ]);
});

test("CDP debug port selection skips occupied ports", async () => {
  const net = require("node:net");
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const occupied = server.address().port;
    assert.equal(await portIsAvailable(occupied), false);
    assert.notEqual(await findAvailablePort(occupied), occupied);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CDP launch port selection skips non-Codex listeners", async () => {
  const http = require("node:http");
  const server = http.createServer((request, response) => {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not Codex CDP");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const occupied = server.address().port;
    const selected = await chooseDebugPortForLaunch(occupied);
    assert.notEqual(selected, occupied);
    assert.equal(await portIsAvailable(selected), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CDP target picker prefers Codex renderer pages", () => {
  const target = pickCodexTarget([
    { id: "one", type: "page", title: "Other", url: "app://-/index.html", webSocketDebuggerUrl: "ws://one" },
    { id: "two", type: "page", title: "Codex", url: "app://-/index.html", webSocketDebuggerUrl: "ws://two" },
  ]);

  assert.equal(target.id, "two");
});

test("CDP target picker prefers the main Codex page over avatar overlay", () => {
  const target = pickCodexTarget([
    { id: "overlay", type: "page", title: "Codex", url: "app://-/index.html?initialRoute=%2Favatar-overlay", webSocketDebuggerUrl: "ws://overlay" },
    { id: "main", type: "page", title: "Codex", url: "app://-/index.html", webSocketDebuggerUrl: "ws://main" },
  ]);

  assert.equal(target.id, "main");
});

test("CDP injection includes every Codex app page target", () => {
  const targets = codexPageTargets([
    { id: "overlay", type: "page", title: "Codex", url: "app://-/index.html?initialRoute=%2Favatar-overlay", webSocketDebuggerUrl: "ws://overlay" },
    { id: "main", type: "page", title: "Codex", url: "app://-/index.html", webSocketDebuggerUrl: "ws://main" },
    { id: "worker", type: "worker", title: "", url: "", webSocketDebuggerUrl: "ws://worker" },
    { id: "web", type: "page", title: "Other", url: "https://example.com", webSocketDebuggerUrl: "ws://web" },
  ]);

  assert.deepEqual(targets.map((target) => target.id), ["overlay", "main"]);
});

test("bridge explains when reinject cannot attach to a debug target", () => {
  assert.match(
    cdpTargetNotReadyMessage({ isDebugPortReady: false, hasCodexTarget: false }, 57330),
    /Launch \+ Inject/,
  );
});

test("bridge clears Codex browser login state for fresh account login", async () => {
  const {
    clearCodexBrowserLoginState,
    codexBrowserSessionPaths,
  } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/bridge-server");
  await withTempHome(async (home) => {
    const paths = codexBrowserSessionPaths(home);
    await fs.mkdir(paths.userDataDir, { recursive: true });
    await fs.writeFile(path.join(paths.userDataDir, "Cookies"), "");
    await fs.writeFile(path.join(paths.userDataDir, "Cookies-journal"), "");
    await fs.mkdir(path.join(paths.userDataDir, "Session Storage"), { recursive: true });
    await fs.writeFile(path.join(paths.userDataDir, "Session Storage", "CURRENT"), "");

    await clearCodexBrowserLoginState(home);

    await assert.rejects(() => fs.access(path.join(paths.userDataDir, "Cookies")));
    await assert.rejects(() => fs.access(path.join(paths.userDataDir, "Session Storage")));
  });
});

test("bridge query preserves JSON error messages from failed bridge requests", async () => {
  const http = require("node:http");
  const server = http.createServer((request, response) => {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: { message: "Use Launch + Inject first." } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    await assert.rejects(
      () => queryBridge(port, "/inject", "POST"),
      /Use Launch \+ Inject first/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("CLI launch path checks whether the default debug port already hosts Codex", () => {
  const source = fsSync.readFileSync(
    path.join(__dirname, "..", "Sources", "CodexAccountSwitcher", "Resources", "cdp-helper", "cli.js"),
    "utf8",
  );

  assert.match(source, /cdpStatus\(options\.debugPort\)/);
  assert.match(source, /hasCodexTarget/);
});

test("Codex process detector recognizes macOS app executable commands", () => {
  const {
    codexProcessListHasMainCommand,
    isCodexMainProcessCommand,
  } = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp");

  assert.equal(
    isCodexMainProcessCommand("38533 /Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=57330"),
    true,
  );
  assert.equal(
    isCodexMainProcessCommand("38607 /Applications/Codex.app/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper --type=renderer"),
    false,
  );
  assert.equal(
    codexProcessListHasMainCommand([
      "38607 /Applications/Codex.app/Contents/Frameworks/Codex Helper (Renderer).app/Contents/MacOS/Codex Helper (Renderer)",
      "38533 /Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=57330",
    ].join("\n")),
    true,
  );
});

test("Codex process detector returns every main process id", () => {
  const output = [
    "81147     1 /Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=57330",
    "82910     1 /Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=57331",
    "82921 82910 /Applications/Codex.app/Contents/Frameworks/Codex Helper.app/Contents/MacOS/Codex Helper --type=renderer",
  ].join("\n");

  assert.deepEqual(codexMainProcessIds(output), [81147, 82910]);
});

test("Codex launcher does not force a new application instance", () => {
  const args = codexLaunchArgs("/Applications/Codex.app", 57330);

  assert.equal(args.includes("-n"), false);
  assert.equal(args.includes("-na"), false);
  assert.deepEqual(args, [
    "/Applications/Codex.app",
    "--args",
    "--remote-debugging-port=57330",
    "--remote-allow-origins=http://127.0.0.1:57330",
  ]);
});

test("renderer injection uses CDP binding bridge instead of Electron preload APIs", () => {
  const source = rendererInjectionSource();

  assert.match(source, /__codexAccountSwitcherBridge/);
  assert.match(source, /data-codex-account-switcher-panel/);
  assert.doesNotMatch(source, /ipcRenderer/);
  assert.doesNotMatch(source, /require\(["']electron["']\)/);
});

test("CDP injection refreshes the renderer binding and allows runtime eval under CSP", () => {
  const source = fsSync.readFileSync(
    path.join(__dirname, "..", "Sources", "CodexAccountSwitcher", "Resources", "cdp-helper", "lib", "cdp.js"),
    "utf8",
  );

  assert.match(source, /Runtime\.removeBinding/);
  assert.match(source, /allowUnsafeEvalBlockedByCSP/);
});

test("renderer injection supports cleanup before reinjection", () => {
  const source = rendererInjectionSource();

  assert.match(source, /__codexAccountSwitcherCleanup/);
  assert.match(source, /previous runtime cleanup failed/);
  assert.doesNotMatch(source, /if \\(window\\.__codexAccountSwitcherInstalled\\) return;/);
});

test("renderer injection adds an Accounts page to native Codex Settings", () => {
  const source = rendererInjectionSource();

  assert.match(source, /data-codex-account-switcher-settings-group/);
  assert.match(source, /findCodexSettingsSidebar/);
  assert.match(source, /Configuration/);
  assert.match(source, /Personalization/);
});

test("renderer new sign-in command starts the multi-account login flow", () => {
  const source = rendererInjectionSource();

  assert.match(source, /action: "start-login"/);
});

test("renderer account popup exposes save and new sign-in actions directly", () => {
  const source = rendererInjectionSource();

  assert.match(source, /menuButton\(t\("save"\)/);
  assert.match(source, /menuButton\(t\("newSignIn"\)/);
});

test("renderer account popup reports async action failures instead of swallowing them", () => {
  const source = rendererInjectionSource();

  assert.match(source, /Promise\.resolve\(action\(\)\)/);
  assert.match(source, /Account Switcher.*menu action failed/);
});

test("renderer starts Codex native ChatGPT login after preparing a new account", () => {
  const source = rendererInjectionSource();

  assert.match(source, /onboarding-login-content-/);
  assert.match(source, /find-codex-asset/);
  assert.match(source, /import\(/);
  assert.match(source, /authUrl/);
  assert.match(source, /action: "open-url"/);
  assert.match(source, /AbortController/);
  assert.match(source, /useStreamlinedLogin:\s*false/);
  assert.match(source, /relaunch:\s*false/);
});

test("renderer switch uses a real Codex relaunch because hot auth refresh is not reliable", () => {
  const source = rendererInjectionSource();

  assert.match(source, /action: "switch", name, relaunch: true/);
  assert.doesNotMatch(source, /account\/login\/start/);
  assert.doesNotMatch(source, /chatgptAuthTokens/);
  assert.doesNotMatch(source, /softRefresh:\s*true/);
});

test("renderer gets a native login URL before clearing the active auth file", () => {
  const source = rendererInjectionSource();
  const loginIndex = source.indexOf("loginResult = await startLogin");
  const clearIndex = source.indexOf('action: "start-login"');

  assert.notEqual(loginIndex, -1);
  assert.notEqual(clearIndex, -1);
  assert.ok(loginIndex < clearIndex);
});

test("renderer asset discovery supports current and legacy Codex asset roots", () => {
  const source = rendererInjectionSource();

  assert.match(source, /webview/);
  assert.match(source, /\(\?:webview\\\/\)\?assets/);
});
