"use strict";

class CdpSession {
  constructor(socket, accountService, logger) {
    this.socket = socket;
    this.accountService = accountService;
    this.logger = logger;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", () => {
      this.closed = true;
      for (const [, pending] of this.pending) pending.reject(new Error("CDP websocket closed"));
      this.pending.clear();
    });
    socket.addEventListener("error", (event) => {
      this.logger(`CDP websocket error: ${event.message || "unknown"}`);
    });
  }

  static connect(websocketURL, accountService, logger) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketURL);
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to CDP websocket.")), 5000);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve(new CdpSession(socket, accountService, logger));
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Failed to connect to CDP websocket."));
      }, { once: true });
    });
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP websocket is closed."));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP command ${method}.`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(payload);
    });
  }

  async handleMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(`CDP command ${pending.method} failed: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result || {});
      return;
    }

    if (message.method === "Runtime.bindingCalled" && message.params?.name === "__codexAccountSwitcherBridge") {
      await this.handleBridgeCall(message.params.payload);
    }
  }

  async handleBridgeCall(rawPayload) {
    let request;
    try {
      request = JSON.parse(rawPayload);
    } catch (error) {
      this.logger(`Bridge payload decode failed: ${error.message}`);
      return;
    }
    const id = request.id;
    const message = request.message || {};
    const result = await this.accountService.handle(message);
    const expression = `window.__codexAccountSwitcherReceive && window.__codexAccountSwitcherReceive(${JSON.stringify(id)}, ${JSON.stringify(result)});`;
    try {
      await this.send("Runtime.evaluate", {
        expression,
        awaitPromise: false,
        allowUnsafeEvalBlockedByCSP: true,
      });
    } catch (error) {
      this.logger(`Bridge response failed: ${error.message}`);
    }
  }

  close() {
    this.closed = true;
    try { this.socket.close(); } catch {}
  }
}

module.exports = { CdpSession };
