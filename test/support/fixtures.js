"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function auth(email, profile = email) {
  return JSON.stringify({
    auth_mode: "chatgpt",
    profile_id: profile,
    email,
    tokens: { access_token: "access", refresh_token: "refresh" },
  });
}

function workspaceAuth(email, accountId, plan = "plus", revision = "original") {
  const claims = {
    email,
    "https://api.openai.com/auth": { chatgpt_account_id: accountId, chatgpt_plan_type: plan },
  };
  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      account_id: accountId,
      id_token: `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`,
      access_token: revision,
      refresh_token: "refresh",
    },
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

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

module.exports = { auth, workspaceAuth, close, listen, withTempHome, writeAsarHeaderFixture };
