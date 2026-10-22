import { NextResponse } from "next/server";
import { navCounts } from "@/lib/navCounts";

export const dynamic = "force-dynamic";

/** Sidebar badge counts; polled by components/NavBadge.tsx. */
export async function GET() {
  return NextResponse.json(navCounts(), { headers: { "Cache-Control": "no-store" } });
}
