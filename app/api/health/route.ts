import { NextResponse } from "next/server";
import { healthProof } from "@/lib/auth.mjs";

export const dynamic = "force-dynamic";

/**
 * "Is this the CRM?" for the launchers (scripts/crm-check.mjs): they send a
 * random nonce and check the proof, a keyed hash only a server holding this
 * CRM's token can make, before opening the browser or stopping anything.
 * Open without sign-in (proxy.ts) and reveals nothing else.
 */
export function GET(req: Request) {
  const nonce = new URL(req.url).searchParams.get("nonce");
  return NextResponse.json({ app: "siryous-crm", proof: nonce ? healthProof(nonce) : null });
}
