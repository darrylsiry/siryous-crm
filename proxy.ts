import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_COOKIE,
  authEnabled,
  consumeSignInCode,
  cookieOptions,
  normalizeToken,
  sessionMatches,
  sessionValue,
  tokenMatches,
} from "./lib/auth.mjs";

/** Host names the CRM answers to: it is only ever reached on this machine. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** Paths that need no sign-in: the launchers' identity check and the sign-in form's target. */
const OPEN_PATHS = new Set(["/signin", "/api/health", "/api/signin", "/favicon.ico"]);

function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
}

/**
 * Access control for the whole app (see lib/auth.mjs). Order of checks:
 *   0. the Host header must name this machine (stops DNS rebinding, even
 *      with CRM_AUTH=off);
 *   1. a sign-in link (?token= or a launcher's one-time ?once=) → set the
 *      cookie and redirect to the clean URL, so the secret never stays in
 *      the address bar or history — even for a browser already signed in;
 *   2. a valid cookie → through, cookie refreshed;
 *   3. otherwise → the sign-in page (API routes get a 401 instead).
 */
export default function proxy(req: NextRequest) {
  const url = req.nextUrl;
  if (!LOOPBACK.has(hostnameOf(req.headers.get("host") ?? url.host))) {
    return new NextResponse("Forbidden: the CRM only answers on this computer's own address.", { status: 403 });
  }
  if (!authEnabled()) return NextResponse.next();
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;

  const token = url.searchParams.has("token") ? normalizeToken(url.searchParams.get("token")) : null;
  const once = url.searchParams.get("once");
  if (token !== null || once !== null) {
    const clean = url.clone();
    clean.searchParams.delete("token");
    clean.searchParams.delete("once");
    if ((token !== null && tokenMatches(token)) || (once !== null && consumeSignInCode(once)) || sessionMatches(cookie)) {
      const res = NextResponse.redirect(clean);
      res.cookies.set(AUTH_COOKIE, sessionValue(), cookieOptions());
      return res;
    }
    const signin = url.clone();
    signin.pathname = "/signin";
    signin.search = "?bad=1";
    return NextResponse.redirect(signin);
  }

  if (sessionMatches(cookie)) {
    const res = NextResponse.next();
    // Refreshed on use; a cookie from before sessionValue (the token itself) is replaced here.
    res.cookies.set(AUTH_COOKIE, sessionValue(), cookieOptions());
    return res;
  }

  if (OPEN_PATHS.has(url.pathname)) return NextResponse.next();
  if (url.pathname.startsWith("/api/")) return new NextResponse("Unauthorized", { status: 401 });
  const signin = url.clone();
  signin.pathname = "/signin";
  signin.search = "";
  return NextResponse.redirect(signin);
}

export const config = {
  // Everything except Next's built static assets (an exact folder prefix).
  matcher: ["/((?!_next/static/).*)"],
};
