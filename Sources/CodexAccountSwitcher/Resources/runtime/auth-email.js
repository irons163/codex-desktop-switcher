"use strict";

function emailFromAuthString(raw) {
  try {
    return emailFromAuth(JSON.parse(raw));
  } catch {
    return null;
  }
}

function emailFromAuth(auth) {
  const direct = auth?.email || auth?.user?.email || auth?.account?.email;
  if (typeof direct === "string" && direct.includes("@")) return direct;
  const idToken = auth?.tokens?.id_token;
  const claims = jwtPayload(idToken);
  const nestedEmail = claims?.["https://api.openai.com/profile"]?.email;
  if (typeof nestedEmail === "string" && nestedEmail.includes("@")) return nestedEmail;
  return typeof claims?.email === "string" && claims.email.includes("@") ? claims.email : null;
}

function jwtPayload(token) {
  if (typeof token !== "string") return null;
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

module.exports = { emailFromAuthString };
