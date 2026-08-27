import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// Must come first: lib/auth.mjs derives the token file from CRM_DB_PATH.
import { dbPath, tmp } from "./helpers/tempdb";
import { AUTH_COOKIE, COOKIE_MAX_AGE, authEnabled, getAuthToken, signInUrl, tokenMatches, tokenPath } from "../lib/auth.mjs";

after(() => tmp.cleanup());

const AUTH_MJS = path.resolve(__dirname, "..", "lib", "auth.mjs");

/** Run getAuthToken() in a separate Node process (fresh module cache) against the same CRM_DB_PATH. */
function tokenFromFreshProcess(env: Record<string, string>): string {
  return execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `import { getAuthToken } from ${JSON.stringify(AUTH_MJS)}; process.stdout.write(getAuthToken());`],
    { env: { ...process.env, ...env }, encoding: "utf8" }
  );
}

describe("getAuthToken", () => {
  test("token file lives next to the database and is created with mode 0600", () => {
    const file = tokenPath();
    assert.equal(file, path.join(path.dirname(dbPath), "auth-token"));
    assert.equal(fs.existsSync(file), false);

    const token = getAuthToken();
    assert.ok(fs.existsSync(file));
    assert.equal(fs.readFileSync(file, "utf8"), token + "\n");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.ok(token.length >= 16);
    assert.match(token, /^[A-Za-z0-9_-]+$/, "base64url alphabet");
  });

  test("the second call returns the same token", () => {
    const first = getAuthToken();
    assert.equal(getAuthToken(), first);
    // ...and so does a fresh process reading the same file.
    assert.equal(tokenFromFreshProcess({ CRM_DB_PATH: dbPath }), first);
  });

  test("a pre-existing token file is honoured; a too-short one is replaced", () => {
    const dir = path.join(tmp.dir, "preexisting");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "auth-token"), "  a-token-that-is-long-enough-1234 \n");
    assert.equal(tokenFromFreshProcess({ CRM_DB_PATH: path.join(dir, "crm.db") }), "a-token-that-is-long-enough-1234");

    const shortDir = path.join(tmp.dir, "short");
    fs.mkdirSync(shortDir, { recursive: true });
    fs.writeFileSync(path.join(shortDir, "auth-token"), "short\n");
    const regenerated = tokenFromFreshProcess({ CRM_DB_PATH: path.join(shortDir, "crm.db") });
    assert.notEqual(regenerated, "short");
    assert.ok(regenerated.length >= 16);
    assert.equal(fs.readFileSync(path.join(shortDir, "auth-token"), "utf8"), regenerated + "\n");
  });
});

describe("tokenMatches", () => {
  test("true only for the exact token", () => {
    const token = getAuthToken();
    assert.equal(tokenMatches(token), true);
    assert.equal(tokenMatches(token + "x"), false);
    assert.equal(tokenMatches(token.slice(0, -1)), false);
    assert.equal(tokenMatches(token.toUpperCase() === token ? token + "!" : token.toUpperCase()), false);
    assert.equal(tokenMatches("definitely-not-the-token"), false);
  });

  test("false for empty and non-string candidates", () => {
    assert.equal(tokenMatches(""), false);
    assert.equal(tokenMatches(undefined), false);
    assert.equal(tokenMatches(null), false);
    assert.equal(tokenMatches(123), false);
    assert.equal(tokenMatches([getAuthToken()]), false);
    assert.equal(tokenMatches({ toString: () => getAuthToken() }), false);
  });
});

describe("signInUrl / authEnabled / constants", () => {
  test("signInUrl embeds the token on the default and a custom origin", () => {
    const token = getAuthToken();
    assert.equal(signInUrl(), `http://127.0.0.1:3000/?token=${encodeURIComponent(token)}`);
    assert.equal(signInUrl("http://localhost:4000"), `http://localhost:4000/?token=${encodeURIComponent(token)}`);
  });

  test("authEnabled reads CRM_AUTH at call time", () => {
    const saved = process.env.CRM_AUTH;
    try {
      delete process.env.CRM_AUTH;
      assert.equal(authEnabled(), true);
      process.env.CRM_AUTH = "on";
      assert.equal(authEnabled(), true);
      process.env.CRM_AUTH = "off";
      assert.equal(authEnabled(), false);
      process.env.CRM_AUTH = "OFF";
      assert.equal(authEnabled(), false);
    } finally {
      if (saved === undefined) delete process.env.CRM_AUTH;
      else process.env.CRM_AUTH = saved;
    }
  });

  test("cookie constants", () => {
    assert.equal(AUTH_COOKIE, "crm_auth");
    assert.equal(COOKIE_MAX_AGE, 365 * 24 * 60 * 60);
  });
});
