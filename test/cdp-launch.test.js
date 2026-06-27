"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fsSync = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { close, listen } = require("./support/fixtures");
const {
  codexDebugArgs,
  codexLaunchArgs,
  codexMainProcessIds,
  codexProcessListHasMainCommand,
  chooseDebugPortForLaunch,
  findAvailablePort,
  isCodexMainProcessCommand,
  portIsAvailable,
  queryBridge,
} = require("../Sources/CodexAccountSwitcher/Resources/cdp-helper/lib/cdp");

test("CDP launcher args enable local browser debugging without app patching", () => {
  assert.deepEqual(codexDebugArgs(57321), [
    "--remote-debugging-port=57321",
    "--remote-allow-origins=http://127.0.0.1:57321",
  ]);
});

test("CDP debug port selection skips occupied ports", async () => {
  const server = net.createServer();
  const occupied = await listen(server);
  try {
    assert.equal(await portIsAvailable(occupied), false);
    assert.notEqual(await findAvailablePort(occupied), occupied);
  } finally {
    await close(server);
  }
});

test("CDP launch port selection skips non-Codex listeners", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not Codex CDP");
  });
  const occupied = await listen(server);
  try {
    const selected = await chooseDebugPortForLaunch(occupied);
    assert.notEqual(selected, occupied);
    assert.equal(await portIsAvailable(selected), true);
  } finally {
    await close(server);
  }
});

test("bridge query preserves JSON error messages from failed bridge requests", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: { message: "Use Launch + Inject first." } }));
  });
  const port = await listen(server);
  try {
    await assert.rejects(
      () => queryBridge(port, "/inject", "POST"),
      /Use Launch \+ Inject first/,
    );
  } finally {
    await close(server);
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

test("CDP injection refreshes the renderer binding and allows runtime eval under CSP", () => {
  const source = fsSync.readFileSync(
    path.join(__dirname, "..", "Sources", "CodexAccountSwitcher", "Resources", "cdp-helper", "lib", "cdp.js"),
    "utf8",
  );

  assert.match(source, /Runtime\.removeBinding/);
  assert.match(source, /allowUnsafeEvalBlockedByCSP/);
});
