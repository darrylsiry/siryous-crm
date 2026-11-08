import Link from "next/link";
import { notFound } from "next/navigation";
import { outreachById } from "@/lib/queries";
import { setOutreachStatus } from "@/lib/actions";
import { shortDate } from "@/lib/dates.mjs";
import Markdown from "@/components/Markdown";
import CopyButton from "@/components/CopyButton";
import PendingButton from "@/components/PendingButton";

export const dynamic = "force-dynamic";

export const metadata = { title: "Outreach" };

export default async function OutreachDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = outreachById(Number(id));
  if (!o) notFound();
  const sent = o.status === "sent";
  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/outreach" className="text-xs text-stone-500 hover:text-indigo-600">
        ← Outreach
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{o.title ?? o.topic ?? "Outreach"}</h1>
          <p className="mt-1 text-sm text-stone-600">
            <span className={sent ? "font-medium text-green-700" : "font-medium text-amber-700"}>{sent ? "Sent" : "Draft"}</span>
            {o.date ? ` · ${shortDate(o.date)}` : ""}
            {o.person_slug ? (
              <>
                {" · to "}
                <Link href={`/people/${o.person_slug}`} className="font-medium text-indigo-700 hover:underline">
                  {o.person_name}
                </Link>
              </>
            ) : null}
            {o.topic && o.title ? ` · ${o.topic}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={o.body ?? ""} label="Copy text" />
          <form action={setOutreachStatus.bind(null, o.id, sent ? "draft" : "sent")}>
            <PendingButton
              label={sent ? "Mark as draft" : "Mark sent"}
              pendingLabel="Saving…"
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            />
          </form>
        </div>
      </header>
      <div className="rounded-xl border border-stone-200 bg-white p-6">
        <Markdown modelWritten>{o.body ?? ""}</Markdown>
      </div>
      <p className="text-xs text-stone-500">
        The CRM doesn&apos;t send anything: copy the text into your email, then mark it sent here.
      </p>
    </div>
  );
}
