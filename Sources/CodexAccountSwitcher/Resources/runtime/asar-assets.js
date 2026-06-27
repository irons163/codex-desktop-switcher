"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");

async function findCodexAssetByPrefix(codexApp, rawPrefix) {
  if (typeof rawPrefix !== "string" || !/^[a-zA-Z0-9._-]+$/.test(rawPrefix)) {
    throw new Error("Asset prefix is required.");
  }
  const asarPath = path.join(codexApp, "Contents", "Resources", "app.asar");
  const header = await readAsarHeader(asarPath);
  const files = collectAsarFiles(header);
  const match = files.find((file) => {
    const fileName = path.posix.basename(file);
    return /\/(?:webview\/)?assets\//.test(file)
      && fileName.startsWith(rawPrefix)
      && fileName.endsWith(".js");
  });
  if (!match) throw new Error(`Codex asset not found: ${rawPrefix}`);
  return {
    path: match,
    fileName: path.posix.basename(match),
  };
}

async function readAsarHeader(asarPath) {
  const handle = await fsp.open(asarPath, "r");
  try {
    const prefix = Buffer.alloc(16);
    await handle.read(prefix, 0, prefix.length, 0);
    const jsonSize = prefix.readUInt32LE(12);
    if (!Number.isFinite(jsonSize) || jsonSize <= 0 || jsonSize > 64 * 1024 * 1024) {
      throw new Error(`Invalid asar header size in ${asarPath}`);
    }
    const json = Buffer.alloc(jsonSize);
    await handle.read(json, 0, jsonSize, 16);
    return JSON.parse(json.toString("utf8"));
  } finally {
    await handle.close();
  }
}

function collectAsarFiles(header) {
  const output = [];
  collectAsarNode(header, "", output);
  return output;
}

function collectAsarNode(node, prefix, output) {
  const files = node?.files;
  if (!files || typeof files !== "object") return;
  for (const [name, child] of Object.entries(files)) {
    const next = `${prefix}/${name}`;
    if (child?.files) collectAsarNode(child, next, output);
    else output.push(next);
  }
}

module.exports = { collectAsarFiles, findCodexAssetByPrefix };
