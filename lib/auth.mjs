/**
 * Local access token. The app has no user accounts; instead a random secret
 * generated on first start (data/auth-token, never leaves the machine) must be
 * presented once per browser, after which a cookie carries it. This stops
 * other software on the same machine — or a web page abusing DNS rebinding —
 * from reading or changing the CRM. Disable with CRM_AUTH=off.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const AUTH_COOKIE = "crm_auth";
export const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // a year, refreshed on use

export function authEnabled() {
  return (process.env.CRM_AUTH ?? "on").toLowerCase() !== "off";
}

export function tokenPath() {
  const dbPath = process.env.CRM_DB_PATH || path.join(process.cwd(), "data", "crm.db");
  return path.join(path.dirname(dbPath), "auth-token");
}

let cached = null;

/** Read the token, generating it on first use. */
export function getAuthToken() {
  if (cached) return cached;
  const file = tokenPath();
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (t.length >= 16) return (cached = t);
  } catch {
    /* not there yet */
  }
  const token = crypto.randomBytes(24).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token + "\n", { mode: 0o600 });
  return (cached = token);
}

/** Constant-time comparison so a wrong token can't be guessed byte by byte. */
export function tokenMatches(candidate) {
  if (typeof candidate !== "string" || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(getAuthToken());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The one-time sign-in URL for a browser that doesn't have the cookie yet. */
export function signInUrl(origin = "http://127.0.0.1:3000") {
  return `${origin}/?token=${encodeURIComponent(getAuthToken())}`;
}
