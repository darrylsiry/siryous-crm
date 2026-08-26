import Link from "next/link";
import { allOutreach } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function OutreachPage() {
  const items = allOutreach();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Outreach</h1>
        <p className="mt-1 text-sm text-stone-500">
          Drafts and sent messages, newest first
        </p>
      </header>
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
                  {o.status}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-stone-400">
                {o.date ?? ""}
                {o.person_name ? ` · ${o.person_name}` : ""}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
