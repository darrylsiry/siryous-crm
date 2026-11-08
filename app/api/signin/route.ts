import { NextResponse } from "next/server";
import { AUTH_COOKIE, consumeSignInCode, cookieOptions, createSession, normalizeToken, tokenMatches } from "@/lib/auth.mjs";

export const dynamic = "force-dynamic";

/**
 * The sign-in form posts here (not a GET), so the code or pasted link never
 * lands in the address bar or browser history.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const pasted = String(form?.get("token") ?? "").trim();
  // A one-time link from Settings → Access (…/?once=<code>), or the token (alone, or in an older ?token= link).
  const once = pasted.match(/[?&]once=([A-Za-z0-9_-]+)/)?.[1];
  const ok = once ? consumeSignInCode(once) : tokenMatches(normalizeToken(pasted));
  if (!ok) return NextResponse.redirect(new URL("/signin?bad=1", req.url), 303);
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(AUTH_COOKIE, createSession(), cookieOptions());
  return res;
}
