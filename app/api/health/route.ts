import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * "Is this the CRM?" for the launchers (Start/Stop/Restart CRM): they check
 * this before saying the CRM is running, so another program on port 3000 is
 * never mistaken for it (or handed the sign-in link). Open without sign-in
 * (proxy.ts) and says nothing but which app answers.
 */
export function GET() {
  return NextResponse.json({ app: "siryous-crm" });
}
