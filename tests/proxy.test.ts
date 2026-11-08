import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
// Must come first: the proxy's token file is derived from CRM_DB_PATH.
import { tmp } from "./helpers/tempdb";
import { NextRequest } from "next/server";
import proxy, { config } from "../proxy";
import { AUTH_COOKIE, createSession, createSignInCode, endOtherSessions, getAuthToken, healthProof, sessionFor } from "../lib/auth.mjs";

// NextURL normalises loopback hosts (127.x, ::1) to "localhost", so redirects come back on this origin.
const ORIGIN = "http://localhost:3000";
let token = "";
let session = "";

before(() => {
  delete process.env.CRM_AUTH;
  token = getAuthToken();
  session = createSession();
});
after(() => tmp.cleanup());

function request(pathAndQuery: string, opts: { cookie?: string; host?: string } = {}) {
  const headers = new Headers();
  if (opts.cookie !== undefined) headers.set("cookie", `${AUTH_COOKIE}=${opts.cookie}`);
  if (opts.host !== undefined) headers.set("host", opts.host);
  return new NextRequest(new URL(pathAndQuery, ORIGIN), { headers });
}

function setCookie(res: Response): string {
  return res.headers.get("set-cookie") ?? "";
}

/** The session a response's Set-Cookie starts, if it is a current one. */
function newSession(res: Response): string | null {
  const value = setCookie(res).match(new RegExp(`^${AUTH_COOKIE}=([^;]+);`))?.[1];
  return value && sessionFor(value) ? value : null;
}

describe("proxy (access control)", () => {
  test("no cookie → 307 to /signin, no cookie set", () => {
    const res = proxy(request("/people/sam-lee?tab=log"));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), `${ORIGIN}/signin`);
    assert.equal(setCookie(res), "");
  });

  test("no cookie on an API path → 401, not a redirect", () => {
    const res = proxy(request("/api/anything"));
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("location"), null);
  });

  test("/signin itself is always reachable", () => {
    const res = proxy(request("/signin"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("location"), null);
  });

  test("?token=good → 307 to the clean URL with the cookie set", () => {
    const res = proxy(request(`/people/sam-lee?tab=log&token=${encodeURIComponent(token)}`));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), `${ORIGIN}/people/sam-lee?tab=log`);
    const cookie = setCookie(res);
    // The cookie names a new session of its own, never the token, and lasts 30 days from use.
    const started = newSession(res);
    assert.ok(started && started !== session);
    assert.doesNotMatch(cookie, new RegExp(token.replace(/[-_]/g, "\\$&")));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=strict/i);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=2592000/);
  });

  test("?token=good on the root → redirect to a bare /", () => {
    const res = proxy(request(`/?token=${encodeURIComponent(token)}`));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), `${ORIGIN}/`);
  });

  test("?token=bad → 307 to /signin?bad=1, no cookie", () => {
    const res = proxy(request("/dashboard?token=nope"));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), `${ORIGIN}/signin?bad=1`);
    assert.equal(setCookie(res), "");
    // An empty token is also "presented" and also wrong.
    assert.equal(proxy(request("/?token=")).headers.get("location"), `${ORIGIN}/signin?bad=1`);
  });

  test("good cookie → 200 and the cookie is refreshed", () => {
    const res = proxy(request("/people", { cookie: session }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("location"), null);
    assert.match(setCookie(res), new RegExp(`^${AUTH_COOKIE}=${session};`));
    assert.match(setCookie(res), /Max-Age=2592000/);
  });

  test("a cookie from before sessions (the token itself) still works once, and is swapped for a session", () => {
    const res = proxy(request("/people", { cookie: token }));
    assert.equal(res.status, 200);
    assert.ok(newSession(res));
  });

  test("a signed cookie whose session has ended, or a forged one, doesn't sign in (SEC-009)", () => {
    const other = createSession();
    assert.equal(proxy(request("/people", { cookie: other })).status, 200);
    endOtherSessions(sessionFor(session));
    assert.equal(proxy(request("/people", { cookie: other })).status, 307, "signed out from another browser");
    assert.equal(proxy(request("/people", { cookie: session })).status, 200, "the browser that asked stays in");
    const [id] = session.split(".");
    assert.equal(proxy(request("/people", { cookie: `${id}.forged` })).status, 307);
  });

  test("good cookie on an API path → 200", () => {
    assert.equal(proxy(request("/api/anything", { cookie: session })).status, 200);
  });

  test("a signed-in browser opening a sign-in link is still sent to the clean URL", () => {
    const res = proxy(request(`/people?token=${encodeURIComponent(token)}`, { cookie: session }));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), `${ORIGIN}/people`);
    assert.equal(setCookie(res), "", "it keeps its session");
    // Even a wrong ?token= with a good cookie just lands on the clean page.
    assert.equal(proxy(request(`/people?token=stale`, { cookie: session })).headers.get("location"), `${ORIGIN}/people`);
  });

  test("a launcher's one-time code signs in once, then is used up", () => {
    const code = createSignInCode();
    const first = proxy(request(`/?once=${code}`));
    assert.equal(first.status, 307);
    assert.equal(first.headers.get("location"), `${ORIGIN}/`);
    assert.ok(newSession(first));
    const again = proxy(request(`/?once=${code}`));
    assert.equal(again.headers.get("location"), `${ORIGIN}/signin?bad=1`);
  });

  test("only this machine's own host names are answered (DNS rebinding), even with CRM_AUTH=off", () => {
    assert.equal(proxy(request("/people", { cookie: session, host: "evil.example:3000" })).status, 403);
    assert.equal(proxy(request("/people", { cookie: session, host: "127.0.0.1:3000" })).status, 200);
    assert.equal(proxy(request("/people", { cookie: session, host: "[::1]:3000" })).status, 200);
    process.env.CRM_AUTH = "off";
    try {
      assert.equal(proxy(request("/people", { host: "10.attacker.example:3000" })).status, 403);
    } finally {
      delete process.env.CRM_AUTH;
    }
  });

  test("the launchers' health check and the sign-in form's target need no sign-in", () => {
    assert.equal(proxy(request("/api/health?nonce=00ff")).status, 200);
    assert.equal(proxy(request("/api/signin")).status, 200);
    // The proof needs the token: a different nonce gives a different answer, and a bad nonce none.
    assert.notEqual(healthProof("0123456789abcdef"), healthProof("0123456789abcdee"));
    assert.equal(healthProof("not hex"), null);
  });

  test("the favicon gets an empty answer, never the app; paths that only look like it still need sign-in (SEC-011)", () => {
    const icon = proxy(request("/favicon.ico"));
    assert.equal(icon.status, 204);
    assert.equal(icon.headers.get("x-middleware-next"), null, "answered here, not passed on to the app");
    assert.equal(proxy(request("/favicon.icoX")).status, 307);
    assert.equal(proxy(request("/favicon.ico/x")).status, 307);
  });

  test("the sign-in box takes a pasted one-time link, once (UX-068)", async () => {
    const { POST } = await import("../app/api/signin/route");
    const post = (token: string) => {
      const body = new FormData();
      body.set("token", token);
      return POST(new Request(`${ORIGIN}/api/signin`, { method: "POST", body }));
    };
    const link = `http://127.0.0.1:3000/?once=${createSignInCode()}`;
    const first = await post(link);
    assert.equal(first.status, 303);
    assert.equal(first.headers.get("location"), `${ORIGIN}/`);
    assert.ok(newSession(first), "signed in");
    const again = await post(link);
    assert.equal(again.headers.get("location"), `${ORIGIN}/signin?bad=1`, "it works once");
    assert.ok(newSession(await post(token)), "the token itself still works");
  });

  test("bad cookie is treated like no cookie", () => {
    const page = proxy(request("/people", { cookie: "wrong" }));
    assert.equal(page.status, 307);
    assert.equal(page.headers.get("location"), `${ORIGIN}/signin`);
    assert.equal(proxy(request("/api/x", { cookie: session.slice(1) })).status, 401);
  });

  test("bad cookie but a good ?token= still signs in", () => {
    const res = proxy(request(`/?token=${encodeURIComponent(token)}`, { cookie: "stale" }));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), `${ORIGIN}/`);
    assert.ok(newSession(res), "a new session replaces the stale cookie");
  });

  test("CRM_AUTH=off → everything passes without a cookie", () => {
    process.env.CRM_AUTH = "off";
    try {
      assert.equal(proxy(request("/people")).status, 200);
      assert.equal(proxy(request("/api/anything")).status, 200);
      assert.equal(setCookie(proxy(request("/people"))), "");
    } finally {
      delete process.env.CRM_AUTH;
    }
    assert.equal(proxy(request("/people")).status, 307);
  });

  test("matcher skips only Next's built static files; everything else goes through the proxy", () => {
    const [pattern] = config.matcher;
    const re = new RegExp(`^${pattern}$`);
    assert.ok(re.test("/"));
    assert.ok(re.test("/people/sam-lee"));
    assert.ok(re.test("/api/x"));
    assert.ok(!re.test("/_next/static/chunk.js"));
    assert.ok(re.test("/_next/image?url=x"));
    assert.ok(re.test("/_next/staticX"));
    assert.ok(re.test("/favicon.icoX"));
  });

  test("the token file was created in the temp directory only", () => {
    assert.ok(fs.existsSync(path.join(tmp.dir, "auth-token")));
  });
});
