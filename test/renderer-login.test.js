"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.isConnected = true;
    this.disabled = false;
    this.text = "";
  }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]);
    return descendants.filter((child) => child.tagName === selector);
  }
}

test("failed New sign-in shows a visible error and leaves the account menu usable", async () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../Sources/CodexAccountSwitcher/Resources/cdp-helper/renderer-inject.js"), "utf8");
  const bootstrap = "  installStyles();\n  document.addEventListener";
  assert.ok(renderer.includes(bootstrap));
  const source = renderer.replace(bootstrap, "  window.test = { renderPanel }; return;\n  document.addEventListener");
  const actions = [];
  const window = {
    location: { href: "app://-/index.html" },
    setTimeout(callback, timeout) { const timer = setTimeout(callback, timeout); timer.unref(); return timer; },
    __codexAccountSwitcherMessages: { en: { newSignIn: "New sign-in", openingSignIn: "Opening sign-in", newSignInDone: "Browser opened" } },
  };
  window.top = window;
  let fails = true;
  window.__codexAccountSwitcherBridge = (raw) => {
    const { id, message } = JSON.parse(raw);
    actions.push(message.action);
    const response = message.action === "preferences" ? { ok: true, preferences: { language: "en" } }
      : message.action === "state" ? { ok: true, state: { accounts: ["work"], accountEmails: {}, current: "work" } }
        : fails ? { ok: false, error: { message: "Browser could not open" } } : { ok: true };
    queueMicrotask(() => window.__codexAccountSwitcherReceive(id, response));
  };
  vm.runInNewContext(source, {
    window, URL, navigator: { language: "en" },
    document: { createElement: (tag) => new Element(tag) },
  });
  const panel = new Element("div");
  await window.test.renderPanel(panel);
  const buttons = panel.querySelectorAll("button");
  const newSignIn = buttons.find((button) => button.textContent === "New sign-in");
  const click = () => newSignIn.listeners.get("click")({ preventDefault() {}, stopPropagation() {} });
  click();
  assert.ok(buttons.every((button) => button.disabled));
  await new Promise(setImmediate);
  assert.ok(panel.textContent.includes("Browser could not open"));
  assert.ok(panel.children.some((node) => node.attributes.get("role") === "alert"));
  assert.ok(buttons.every((button) => !button.disabled));
  assert.equal(newSignIn.isConnected, true);
  fails = false;
  click();
  await new Promise(setImmediate);
  assert.ok(panel.textContent.includes("Browser opened"));
  assert.ok(buttons.every((button) => !button.disabled));
  assert.equal(actions.filter((action) => action === "new-sign-in").length, 2);
});
