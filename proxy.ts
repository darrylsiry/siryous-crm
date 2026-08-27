import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, COOKIE_MAX_AGE, authEnabled, getAuthToken, tokenMatches } from "./lib/auth.mjs";

/**
 * Access control for the whole app (see lib/auth.mjs). Order of checks:
 *   1. a valid cookie → through (cookie refreshed);
 *   2. a valid ?token= in the URL → set the cookie and redirect to the clean URL;
 *   3. otherwise → the sign-in page (API routes get a 401 instead).
 */
export default function proxy(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const url = req.nextUrl;

  if (tokenMatches(req.cookies.get(AUTH_COOKIE)?.value)) {
    const res = NextResponse.next();
    res.cookies.set(AUTH_COOKIE, getAuthToken(), cookieOptions());
    return res;
  }

  const presented = url.searchParams.get("token");
  if (presented !== null) {
    const clean = url.clone();
    clean.searchParams.delete("token");
    if (tokenMatches(presented)) {
      const res = NextResponse.redirect(clean);
      res.cookies.set(AUTH_COOKIE, getAuthToken(), cookieOptions());
      return res;
    }
    const signin = url.clone();
    signin.pathname = "/signin";
    signin.search = "?bad=1";
    return NextResponse.redirect(signin);
  }

  if (url.pathname === "/signin") return NextResponse.next();
  if (url.pathname.startsWith("/api/")) return new NextResponse("Unauthorized", { status: 401 });
  const signin = url.clone();
  signin.pathname = "/signin";
  signin.search = "";
  return NextResponse.redirect(signin);
}

function cookieOptions() {
  return { httpOnly: true, sameSite: "strict" as const, path: "/", maxAge: COOKIE_MAX_AGE };
}

export const config = {
  // Everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
