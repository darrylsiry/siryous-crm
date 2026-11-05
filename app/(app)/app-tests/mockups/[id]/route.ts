import { readMockup } from "@/lib/agentActivity";

export const dynamic = "force-dynamic";

/** A UX finding's before/after mockup, opened from App Tests. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const html = readMockup((await params).id);
  if (!html) return new Response("No mockup on file for that finding.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The UX agent writes these pages: show them sandboxed, with no scripts and no access to this site's cookies or storage.
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
      "Cache-Control": "no-store",
    },
  });
}
