/**
 * Local access token. The app has no user accounts; instead a random secret
 * generated on first start (data/auth-token, never leaves the machine) must be
 * presented once per browser, after which a cookie names that browser's own
 * sign-in session (a random id signed with the token, never the token itself;
 * see createSession). This stops web pages — including one
 * abusing DNS rebinding — and programs talking to the server from reading or
 * changing the CRM. Disable with CRM_AUTH=off. The launchers sign a browser in
 * with a one-time code (createSignInCode) rather than the token, so the token
 * stays out of the address bar, browser history and process arguments.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const AUTH_COOKIE = "crm_auth";
/** A sign-in lasts this long after its last use (the cookie and the session alike). */
export const SESSION_DAYS = 30;
export const COOKIE_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;
const SESSION_MS = COOKIE_MAX_AGE * 1000;
/** However much it is used, a sign-in ends this long after it started: a copied cookie can't live forever. */
export const SESSION_MAX_DAYS = 90;
const SESSION_MAX_MS = SESSION_MAX_DAYS * 86_400_000;

export function authEnabled() {
  return (process.env.CRM_AUTH ?? "on").toLowerCase() !== "off";
}

export function tokenPath() {
  const dbPath = process.env.CRM_DB_PATH || path.join(process.cwd(), "data", "crm.db");
  return path.join(path.dirname(dbPath), "auth-token");
}

let cached = null;
let justCreated = false;

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
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, token + "\n", { mode: 0o600 });
  justCreated = true;
  return (cached = token);
}

/**
 * Did this process generate the token (i.e. no usable token file existed
 * before it started)? That is what "first run" means to the server: the
 * person has never signed a browser in, so it opens the sign-in link for them.
 */
export function wasJustCreated() {
  getAuthToken();
  return justCreated;
}

/**
 * What someone pasted into the sign-in box, as a token: trimmed, and when it
 * is the whole sign-in link (http://127.0.0.1:3000/?token=…), just its token.
 */
export function normalizeToken(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/[?&]token=([^&#\s]+)/);
  if (!m) return s;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Constant-time comparison so a wrong value can't be guessed byte by byte. */
function sameSecret(candidate, expected) {
  if (typeof candidate !== "string" || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function tokenMatches(candidate) {
  return sameSecret(candidate, getAuthToken());
}

/** A keyed hash of the token for one purpose: what the cookie carries, the launchers' proof. */
function derived(purpose) {
  return crypto.createHmac("sha256", getAuthToken()).update(purpose).digest("base64url");
}

/** Where sign-in sessions are kept (next to the token, owner-only): { id: expires-at in ms }. */
function sessionsPath() {
  return path.join(path.dirname(tokenPath()), "sessions.json");
}

function readSessions() {
  try {
    const v = JSON.parse(fs.readFileSync(sessionsPath(), "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function writeSessions(all) {
  getAuthToken(); // the folder must exist
  fs.writeFileSync(sessionsPath(), JSON.stringify(all), { mode: 0o600 });
}

const signed = (id) => `${id}.${derived(`crm-session-v2:${id}`)}`;

/**
 * Start a sign-in session for one browser; returns the cookie value: a random
 * id and its signature with the token. Cookies aren't kept apart by port, so
 * another server on 127.0.0.1 could receive it: it never learns the token,
 * the session ends 30 days after its last use, and "Sign out other browsers"
 * (or a new token) ends it at once.
 */
export function createSession(now = Date.now()) {
  const id = crypto.randomBytes(18).toString("base64url");
  const live = Object.fromEntries(Object.entries(readSessions()).filter(([, s]) => entry(s).expires > now));
  live[id] = { created: now, expires: now + SESSION_MS };
  writeSessions(live);
  return signed(id);
}

/** A stored session: { created, expires } (an earlier version stored the expiry alone). */
function entry(s) {
  return typeof s === "number" ? { created: s - SESSION_MS, expires: s } : { created: Number(s?.created) || 0, expires: Number(s?.expires) || 0 };
}

/** The session a cookie value names, if it is signed with this token and still current; null otherwise. */
export function sessionFor(candidate, now = Date.now()) {
  if (typeof candidate !== "string") return null;
  const id = candidate.split(".")[0];
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || !sameSecret(candidate, signed(id))) return null;
  const s = readSessions()[id];
  return s !== undefined && entry(s).expires > now ? id : null;
}

/** Keep a session in use alive for another 30 days, but never past 90 from sign-in (written at most once a day). */
export function touchSession(id, now = Date.now()) {
  const all = readSessions();
  if (!(id in all)) return;
  const s = entry(all[id]);
  const expires = Math.min(now + SESSION_MS, s.created + SESSION_MAX_MS);
  if (expires - s.expires < 86_400_000) return;
  all[id] = { created: s.created, expires };
  writeSessions(all);
}

/** The browsers signed in now, newest first, for Settings → Access. */
export function listSessions(now = Date.now()) {
  return Object.entries(readSessions())
    .map(([id, s]) => ({ id, ...entry(s) }))
    .filter((s) => s.expires > now)
    .sort((a, b) => b.created - a.created);
}

/** End every sign-in except `keepId` (the browser asking). */
export function endOtherSessions(keepId) {
  const all = readSessions();
  writeSessions(keepId && keepId in all ? { [keepId]: all[keepId] } : {});
}

/** A cookie from before sessions held the token itself: it signs in once, and is swapped for a session. */
export function legacyCookie(candidate) {
  return tokenMatches(candidate);
}

export function cookieOptions() {
  return { httpOnly: true, sameSite: "strict", path: "/", maxAge: COOKIE_MAX_AGE };
}

/**
 * Proof for the launchers that the server answering on the port is this CRM:
 * a keyed hash of their random nonce, which only a server holding the token
 * can make. Nonces are short hex strings.
 */
export function healthProof(nonce) {
  if (typeof nonce !== "string" || !/^[0-9a-f]{16,64}$/.test(nonce)) return null;
  return derived(`health:${nonce}`);
}

/** Where a pending one-time sign-in code waits (next to the token, owner-only). */
function signInCodePath() {
  return path.join(path.dirname(tokenPath()), "signin-once");
}

/** A one-time sign-in code is good for this long. */
const SIGN_IN_CODE_MS = 2 * 60 * 1000;

/**
 * A one-time sign-in code for the launcher to open (/?once=<code>): good once,
 * for two minutes, so the long-lived token never appears in a URL.
 */
export function createSignInCode() {
  getAuthToken(); // the token (and its folder) must exist
  const code = crypto.randomBytes(18).toString("base64url");
  fs.writeFileSync(signInCodePath(), JSON.stringify({ code, expires: Date.now() + SIGN_IN_CODE_MS }), { mode: 0o600 });
  return code;
}

/** Use up a one-time sign-in code: true if it is the pending one and still fresh. It works once either way. */
export function consumeSignInCode(candidate) {
  const file = signInCodePath();
  let pending = null;
  try {
    pending = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  const ok = sameSecret(candidate, String(pending?.code ?? "")) && Number(pending?.expires) > Date.now();
  if (ok) fs.rmSync(file, { force: true });
  return ok;
}

