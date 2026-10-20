"use strict";

const { emailFromAuthString } = require("./auth-email");

// Token claims are used only to group local snapshots, not to authenticate them.
function identityFromAuthString(raw) {
  let auth;
  try {
    auth = JSON.parse(raw);
  } catch {
    return null;
  }
  const claims = jwtClaims(auth?.tokens?.id_token);
  const accessClaims = jwtClaims(auth?.tokens?.access_token);
  const metadata = claims?.["https://api.openai.com/auth"] || accessClaims?.["https://api.openai.com/auth"] || {};
  // account_id identifies the selected workspace; organization memberships do not.
  const accountId = nonemptyString(auth?.tokens?.account_id) || nonemptyString(metadata.chatgpt_account_id);
  const email = emailFromAuthString(raw);
  const userId = nonemptyString(metadata.chatgpt_user_id) || nonemptyString(metadata.user_id);
  const principal = email ? `email:${email.trim().toLowerCase()}` : userId ? `user:${userId}` : null;
  const metadataMatches = !accountId || !metadata.chatgpt_account_id || metadata.chatgpt_account_id === accountId;
  const planType = metadataMatches ? nonemptyString(metadata.chatgpt_plan_type)?.toLowerCase() || null : null;
  const key = principal ? JSON.stringify(accountId ? ["workspace", principal, accountId] : ["legacy", principal, planType]) : null;
  const planLabels = { free: "Free", plus: "Plus", pro: "Pro", prolite: "Pro Lite", team: "Business", business: "Business", enterprise: "Enterprise", edu: "Edu" };
  const planLabel = Object.hasOwn(planLabels, planType) ? planLabels[planType] : null;
  const workspaceLabel = [planLabel, accountId?.slice(-8)].filter(Boolean).join(" · ") || null;
  return { email, accountId, planType, key, workspaceLabel };
}

function nonemptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jwtClaims(token) {
  if (typeof token !== "string") return null;
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

module.exports = { identityFromAuthString };
