import { NextResponse } from "next/server";
import { navCounts } from "@/lib/navCounts";
import { noteAppActivity } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Sidebar badge counts; polled by components/NavBadge.tsx. ?active=1 means a person just did something. */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.has("active")) noteAppActivity();
  return NextResponse.json(navCounts(), { headers: { "Cache-Control": "no-store" } });
}
