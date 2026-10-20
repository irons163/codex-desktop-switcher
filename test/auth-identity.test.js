"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { auth, workspaceAuth } = require("./support/fixtures");
const { identityFromAuthString: identity } = require("../Sources/CodexAccountSwitcher/Resources/runtime/auth-identity");

const token = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

test("selected account ID takes precedence over claims and organization memberships", () => {
  const selected = JSON.stringify({ tokens: { account_id: "selected", id_token: token({
    email: "same@example.com",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "other", chatgpt_plan_type: "team",
      organizations: [{ id: "membership", is_default: true, title: "Unselected organization" }],
    },
  }) } });
  const result = identity(selected);
  assert.equal(result.accountId, "selected");
  assert.equal(result.planType, null);
  assert.equal(result.workspaceLabel, "selected");
  assert.equal(result.key, identity(workspaceAuth("same@example.com", "selected")).key);
});

test("workspace ID falls back to ID or access token claims and supports nested profile email", () => {
  const metadata = { chatgpt_account_id: "workspace", chatgpt_plan_type: "enterprise" };
  const result = identity(JSON.stringify({ tokens: { id_token: token({
    "https://api.openai.com/profile": { email: "nested@example.com" },
    "https://api.openai.com/auth": metadata,
  }) } }));
  assert.equal(result.email, "nested@example.com");
  assert.equal(result.accountId, "workspace");
  assert.match(result.workspaceLabel, /^Enterprise/);
  const access = identity(JSON.stringify({ email: "nested@example.com", tokens: {
    access_token: token({ "https://api.openai.com/auth": metadata }),
  } }));
  assert.equal(access.key, result.key);
});

test("plan upgrades and refreshed tokens preserve workspace identity", () => {
  assert.equal(identity(workspaceAuth("same@example.com", "workspace", "plus")).key,
    identity(workspaceAuth("SAME@example.com", "workspace", "pro", "new-token")).key);
});

test("legacy snapshots use plan type conservatively and cannot collide with known workspaces", () => {
  const legacy = (plan) => JSON.stringify({ email: "same@example.com", tokens: {
    id_token: token({ "https://api.openai.com/auth": { chatgpt_plan_type: plan } }),
  } });
  assert.notEqual(identity(legacy("plus")).key, identity(legacy("team")).key);
  assert.notEqual(identity(auth("same@example.com")).key, identity(workspaceAuth("same@example.com", "workspace")).key);
  assert.equal(identity(auth("same@example.com", "old")).key, identity(auth("SAME@example.com", "new")).key);
});

test("a workspace shared by users needs a principal before credentials can be merged", () => {
  const raw = (user) => JSON.stringify({ tokens: { account_id: "shared", id_token: token({
    "https://api.openai.com/auth": { chatgpt_user_id: user },
  }) } });
  assert.notEqual(identity(raw("user-one")).key, identity(raw("user-two")).key);
  assert.equal(identity(raw(undefined)).key, null);
  assert.equal(identity("not JSON"), null);
});
