"use strict";

const childProcess = require("node:child_process");

function accountChooserURL(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) throw new Error("Login URL is required.");
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) login URLs are supported.");
  }
  if (url.protocol !== "https:" || url.hostname !== "auth.openai.com"
    || url.port || url.username || url.password) {
    throw new Error("Only official OpenAI HTTPS sign-in URLs are supported.");
  }
  url.searchParams.delete("prompt");
  url.searchParams.set("max_age", "0");
  return url.toString();
}

async function openAccountChooserURL(rawUrl, opener = openExternalURL) {
  const url = accountChooserURL(rawUrl);
  await opener(url);
  return url;
}

function openExternalURL(url) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("open", [url], { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

module.exports = { accountChooserURL, openAccountChooserURL, openExternalURL };
