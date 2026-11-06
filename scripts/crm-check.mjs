#!/usr/bin/env node
/**
 * Is the server answering on the CRM's address this CRM? Used by the
 * launchers before they open the browser (with a sign-in code) or stop
 * anything. Sends a random nonce to /api/health and checks the proof against
 * this folder's token (found the way the server finds it, .env.local
 * included). Exit 0: it is the CRM. 1: nothing answers. 2: something else
 * answers.
 *
 *   node scripts/crm-check.mjs [http://127.0.0.1:3000]
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";

const url = process.argv[2] || "http://127.0.0.1:3000";
try {
  createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
} catch {
  /* no @next/env yet (first install): the defaults apply */
}
const { healthProof } = await import("../lib/auth.mjs");

const nonce = crypto.randomBytes(16).toString("hex");
let res;
try {
  res = await fetch(`${url}/api/health?nonce=${nonce}`, { signal: AbortSignal.timeout(3000), redirect: "manual" });
} catch {
  process.exit(1);
}
let body = null;
try {
  body = await res.json();
} catch {
  /* not JSON: not the CRM */
}
const expected = healthProof(nonce);
const a = Buffer.from(String(body?.proof ?? ""));
const b = Buffer.from(String(expected ?? ""));
process.exit(body?.app === "siryous-crm" && expected && a.length === b.length && crypto.timingSafeEqual(a, b) ? 0 : 2);
