import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { emailOf, loadInboxRow, parseIds, parsePeople } from "@/lib/inbox";
import { cleanSubject } from "@/lib/inboxRoute";
import { ignoreInboxMessage, rerouteInboxMessage } from "@/lib/inboxActions";

export const dynamic = "force-dynamic";

const smallBtn = "rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50";

/** The email as it arrived at the CRM address: headers, then the body verbatim. */
export default async function InboxMessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = loadInboxRow(db, Number(id));
  if (!row) notFound();
  const email = emailOf(row);
  const intakeIds = parseIds(row.intake_draft_ids);
  const pending = parsePeople(row.pending_people);
  const draftStatus = (table: "log_drafts" | "intake_drafts", draftId: number) =>
    (db.prepare(`SELECT status FROM ${table} WHERE id=?`).get(draftId) as { status: string } | undefined)?.status ?? "gone";

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-xs text-stone-400">
        <Link href="/inbox" className="underline">
          ← Inbox
        </Link>
      </p>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{cleanSubject(email.subject) || "(no subject)"}</h1>
        <p className="mt-1 text-sm text-stone-500">
          Received at the CRM address {row.date ?? row.created_at.slice(0, 10)} · picked up {row.created_at}
        </p>
      </header>

      <section className="rounded-xl border border-stone-200 bg-white p-5 text-sm">
        <dl className="grid grid-cols-[5rem_1fr] gap-y-1 text-stone-700">
          <dt className="text-stone-400">Subject</dt>
          <dd>{email.subject || <span className="text-stone-400">(none)</span>}</dd>
          <dt className="text-stone-400">From</dt>
          <dd>{email.from || <span className="text-stone-400">(unknown)</span>}</dd>
          <dt className="text-stone-400">To</dt>
          <dd>{email.to.length ? email.to.join(", ") : <span className="text-stone-400">(none)</span>}</dd>
          {email.cc.length ? (
            <>
              <dt className="text-stone-400">Cc</dt>
              <dd>{email.cc.join(", ")}</dd>
            </>
          ) : null}
          <dt className="text-stone-400">Date</dt>
          <dd>{row.date ?? <span className="text-stone-400">(not given)</span>}</dd>
        </dl>
        <pre className="mt-4 whitespace-pre-wrap break-words border-t border-stone-100 pt-4 font-sans text-sm leading-relaxed text-stone-800">
          {email.body.trim() || "(empty body)"}
        </pre>
      </section>

      <section className="rounded-xl border border-stone-200 bg-stone-50 p-5 text-sm space-y-3">
        <h2 className="text-base font-semibold text-stone-800">What the CRM did with it</h2>
        {row.status === "routed" ? (
          <>
            <p className="text-stone-600">
              Routed as <b>{row.route}</b>
              {row.note ? <> — {row.note}</> : null}.
            </p>
            <ul className="space-y-1">
              {row.log_draft_id ? (
                <li>
                  <Link href={`/log/${row.log_draft_id}`} className="font-medium text-indigo-700 hover:underline">
                    Log draft #{row.log_draft_id}
                  </Link>{" "}
                  <span className="text-stone-500">[{draftStatus("log_drafts", row.log_draft_id)}]</span>
                </li>
              ) : null}
              {intakeIds.map((d) => (
                <li key={d}>
                  <Link href={`/intake/${d}`} className="font-medium text-indigo-700 hover:underline">
                    Intake draft #{d}
                  </Link>{" "}
                  <span className="text-stone-500">[{draftStatus("intake_drafts", d)}]</span>
                </li>
              ))}
            </ul>
            {pending.length ? (
              <div className="flex flex-wrap items-center gap-1.5 text-stone-600">
                Also on this email:
                {pending.map((p) => (
                  <form key={p.email} action={rerouteInboxMessage} className="inline">
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="back" value="message" />
                    <input type="hidden" name="who" value={p.email} />
                    <button className={smallBtn} title={`Draft an Intake for ${p.email}`}>
                      + {p.name ?? p.email}
                    </button>
                  </form>
                ))}
              </div>
            ) : null}
          </>
        ) : row.status === "error" ? (
          <p className="text-red-700">Couldn&apos;t route: {row.error}</p>
        ) : row.status === "ignored" ? (
          <p className="text-stone-500">Ignored.</p>
        ) : (
          <p className="text-stone-500">Waiting to be routed.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-stone-500">
          <span>{row.status === "routed" ? "Wrong guess? Redo this email" : "Route this email"}</span>
          <form action={rerouteInboxMessage} className="inline">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="back" value="message" />
            <input type="hidden" name="as" value="log" />
            <button className={smallBtn} title="Discard the drafts made for this email and draft it again as a Log entry">
              as Log
            </button>
          </form>
          <form action={rerouteInboxMessage} className="inline">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="back" value="message" />
            <input type="hidden" name="as" value="intake" />
            <button className={smallBtn} title="Discard the drafts made for this email and draft it again as an Intake for the sender">
              as Intake
            </button>
          </form>
          {row.status !== "ignored" ? (
            <form action={ignoreInboxMessage} className="inline">
              <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="back" value="message" />
              <button className={`${smallBtn} text-stone-400`} title="Leave this email out">
                ignore
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}
