import { NextResponse } from "next/server";
import { AUTH_COOKIE, cookieOptions, normalizeToken, sessionValue, tokenMatches } from "@/lib/auth.mjs";

export const dynamic = "force-dynamic";

/**
 * The sign-in form posts here (not a GET), so the code or pasted link never
 * lands in the address bar or browser history.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const token = normalizeToken(String(form?.get("token") ?? ""));
  if (!tokenMatches(token)) return NextResponse.redirect(new URL("/signin?bad=1", req.url), 303);
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(AUTH_COOKIE, sessionValue(), cookieOptions());
  return res;
}
