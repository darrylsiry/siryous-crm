import Link from "next/link";
import { allOutreach } from "@/lib/queries";
import { shortDate } from "@/lib/dates.mjs";

export const dynamic = "force-dynamic";

export const metadata = { title: "Outreach" };

export default function OutreachPage() {
  const items = allOutreach();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Outreach</h1>
        <p className="mt-1 text-sm text-stone-600">
          Imported drafts and sent messages, newest first. Open one to copy it or mark it sent.
        </p>
      </header>
      {!items.length ? (
        <p className="rounded-xl border border-stone-200 bg-white p-4 text-sm italic text-stone-500">
          Nothing here yet. This section shows imported drafts and sent messages linked to
          contacts — the app doesn&apos;t create outreach entries itself, so it stays empty until
          some are imported. Log emails as interactions on a person&apos;s profile instead.
        </p>
      ) : null}
      <ul className="space-y-3">
        {items.map((o) => (
          <li key={o.id}>
            <Link
              href={`/outreach/${o.id}`}
              className="block rounded-xl border border-stone-200 bg-white p-4 hover:border-indigo-300"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sm">{o.title ?? o.topic}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ring-1 ring-inset ${
                    o.status === "sent"
                      ? "bg-green-50 text-green-700 ring-green-600/20"
                      : "bg-amber-50 text-amber-700 ring-amber-600/20"
                  }`}
                >
                  {o.status === "sent" ? "Sent" : "Draft"}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-stone-500">
                {o.date ? shortDate(o.date) || o.date : ""}
                {o.person_name ? ` · ${o.person_name}` : ""}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
