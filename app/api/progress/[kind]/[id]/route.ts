import { NextResponse } from "next/server";
import { readProgress, PROGRESS_TABLES, type ProgressKind } from "@/lib/progress";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind, id } = await params;
  if (!(Object.hasOwn(PROGRESS_TABLES, kind))) {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }
  const data = readProgress(kind as ProgressKind, Number(id));
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
