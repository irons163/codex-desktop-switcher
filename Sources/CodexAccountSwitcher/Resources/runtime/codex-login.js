"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { accountChooserURL } = require("./login-url");

function findCodexCLI(codexApp, environment = process.env) {
  const resources = path.join(codexApp, "Contents", "Resources");
  const candidates = [
    path.join(resources, "codex-cli", "bin", "codex"),
    path.join(resources, "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
    path.join(resources, "codex"),
    ...(environment.PATH || "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, "codex")),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("Codex sign-in service was not found. Install or update the Codex desktop app or Codex CLI.");
}

function createCodexLogin(options) {
  const spawn = options.spawn || childProcess.spawn;
  const startupTimeoutMs = options.startupTimeoutMs || 20000;
  const loginTimeoutMs = options.loginTimeoutMs || 10 * 60 * 1000;
  let active = null;
  let opening = false;

  return {
    async start() {
      if (opening) throw new Error("A sign-in window is already being opened.");
      opening = true;
      try {
        await this.cancel();
        const executable = options.executable || findCodexCLI(options.codexApp);
        const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        const session = new LoginSession(child, { startupTimeoutMs, loginTimeoutMs });
        active = session;
        session.completion.then(async (result) => {
          if (active !== session) return;
          active = null;
          if (result.success) await options.onComplete?.();
          else options.onError?.(new Error("Codex sign-in was not completed. Try New sign-in again."));
        }).catch((error) => {
          if (active === session) active = null;
          options.onError?.(error);
        });
        try {
          await session.start(options.openURL);
          return { loginPending: true };
        } catch (error) {
          if (active === session) active = null;
          await session.cancel();
          throw error;
        }
      } finally {
        opening = false;
      }
    },
    async cancel() {
      const session = active;
      active = null;
      if (session) await session.cancel();
    },
  };
}

class LoginSession {
  constructor(child, { startupTimeoutMs, loginTimeoutMs }) {
    this.child = child;
    this.closed = false;
    this.pending = new Map();
    this.nextId = 0;
    this.loginId = null;
    this.notifications = [];
    this.completion = new Promise((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
    this.completion.catch(() => {});
    this.startupTimeout = new Promise((_, reject) => {
      this.startupTimer = setTimeout(() => {
        const error = new Error("Opening Codex sign-in timed out. Try New sign-in again.");
        reject(error);
        this.fail(error);
      }, startupTimeoutMs);
    });
    this.startupTimeout.catch(() => {});
    this.loginTimeoutMs = loginTimeoutMs;
    this.lines = readline.createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.receive(line));
    child.stderr.resume(); // Never retain OAuth URLs, tokens, or raw service logs.
    child.on("error", () => this.fail(new Error("Could not start the Codex sign-in service.")));
    child.on("exit", () => {
      if (!this.closed) this.fail(new Error("The Codex sign-in service exited before sign-in completed."));
    });
    child.stdin.on("error", () => {
      if (!this.closed) this.fail(new Error("The Codex sign-in service disconnected."));
    });
  }

  async start(openURL) {
    await Promise.race([
      this.open(openURL),
      this.startupTimeout,
      this.completion.then(() => { throw new Error("Codex sign-in ended before the browser opened."); }),
    ]);
    clearTimeout(this.startupTimer);
    if (!this.closed) {
      this.loginTimer = setTimeout(() => {
        this.fail(new Error("Codex sign-in expired. Try New sign-in again."));
      }, this.loginTimeoutMs);
    }
  }

  async open(openURL) {
    await this.request("initialize", {
      clientInfo: { name: "codex_account_switcher", title: "Codex Account Switcher", version: "0.1.3" },
    });
    this.write({ method: "initialized", params: {} });
    const login = await this.request("account/login/start", { type: "chatgpt" });
    if (login.type !== "chatgpt" || !login.loginId || !login.authUrl) {
      throw new Error("Codex did not return a sign-in URL. Update Codex and try again.");
    }
    this.loginId = login.loginId;
    const url = accountChooserURL(login.authUrl);
    for (const notification of this.notifications) this.complete(notification);
    this.notifications = [];
    if (this.closed) throw new Error("Codex sign-in ended before the browser opened.");
    await openURL(url);
  }

  write(message) {
    if (this.closed) throw new Error("The Codex sign-in service is closed.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.write({ id, method, params }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error("Codex could not start sign-in. Close other sign-in windows and try again."));
      else pending.resolve(message.result || {});
    } else if (message.method === "account/login/completed") {
      if (this.loginId) this.complete(message.params);
      else this.notifications.push(message.params);
    }
  }

  complete(result) {
    if (this.closed || result?.loginId !== this.loginId) return;
    this.resolveCompletion({ success: result.success === true });
    this.close();
  }

  fail(error) {
    if (this.closed) return;
    this.rejectCompletion(error);
    this.close();
  }

  async cancel() {
    if (this.closed) return;
    if (this.loginId) {
      try { this.write({ id: ++this.nextId, method: "account/login/cancel", params: { loginId: this.loginId } }); } catch {}
    }
    this.resolveCompletion({ success: false });
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.startupTimer);
    clearTimeout(this.loginTimer);
    this.lines.close();
    for (const pending of this.pending.values()) pending.reject(new Error("The Codex sign-in service is closed."));
    this.pending.clear();
    this.child.stdin.end();
    this.child.kill("SIGTERM");
  }
}

module.exports = { createCodexLogin, findCodexCLI };
