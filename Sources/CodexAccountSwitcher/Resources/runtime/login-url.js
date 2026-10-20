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

function openExternalURL(url, spawn = childProcess.spawn) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/open", [url], { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Could not open the sign-in browser. Check your default browser and try again."));
    });
  });
}

module.exports = { accountChooserURL, openAccountChooserURL, openExternalURL };
