import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { emailOf, loadInboxRow, markInboxRead, parseIds, parsePeople, UNKNOWN_SENDER_ROUTE } from "@/lib/inbox";
import { cleanSubject } from "@/lib/inboxRoute";
import { rerouteInboxMessage } from "@/lib/inboxActions";
import { stateTone, stateWord } from "@/lib/stateWords";
import { localStamp, shortDate } from "@/lib/dates.mjs";
import InboxRedo from "@/components/InboxRedo";
import FlashBanner from "@/components/FlashBanner";

export const metadata = { title: "Email" };

const ROUTE_WORDS: Record<string, string> = { log: "a Log draft", intake: "an Intake draft", both: "a Log draft and an Intake draft" };

export const dynamic = "force-dynamic";

const smallBtn = "rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50";

/** The email as it arrived at the CRM address: headers, then the body verbatim. */
export default async function InboxMessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const db = getDb();
  const row = loadInboxRow(db, Number(id));
  if (!row) notFound();
  markInboxRead(row.id, db);
  const email = emailOf(row);
  const intakeIds = parseIds(row.intake_draft_ids);
  const pending = parsePeople(row.pending_people);
  const draftStatus = (table: "log_drafts" | "intake_drafts", draftId: number) =>
    (db.prepare(`SELECT status FROM ${table} WHERE id=?`).get(draftId) as { status: string } | undefined)?.status ?? "gone";

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-xs text-stone-500">
        <Link href="/inbox" className="underline">
          ← Inbox
        </Link>
      </p>
      {saved ? (
        <FlashBanner cleanHref={`/inbox/${row.id}`} className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {saved}
        </FlashBanner>
      ) : null}
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{cleanSubject(email.subject) || "(no subject)"}</h1>
        <p className="mt-1 text-sm text-stone-600">
          Sent {row.date ? shortDate(row.date) : "(no date given)"} · picked up {localStamp(row.created_at)}
        </p>
      </header>

      <section className="rounded-xl border border-stone-200 bg-white p-5 text-sm">
        <dl className="grid grid-cols-[5rem_1fr] gap-y-1 text-stone-700">
          <dt className="text-stone-500">Subject</dt>
          <dd>{email.subject || <span className="text-stone-500">(none)</span>}</dd>
          <dt className="text-stone-500">From</dt>
          <dd>{email.from || <span className="text-stone-500">(unknown)</span>}</dd>
          <dt className="text-stone-500">To</dt>
          <dd>{email.to.length ? email.to.join(", ") : <span className="text-stone-500">(none)</span>}</dd>
          {email.cc.length ? (
            <>
              <dt className="text-stone-500">Cc</dt>
              <dd>{email.cc.join(", ")}</dd>
            </>
          ) : null}
          <dt className="text-stone-500">Date</dt>
          <dd>{row.date ?? <span className="text-stone-500">(not given)</span>}</dd>
        </dl>
        <pre className="mt-4 whitespace-pre-wrap break-words border-t border-stone-100 pt-4 font-sans text-sm leading-relaxed text-stone-800">
          {email.body.trim() || (row.status === "ignored" ? "(Not kept: ignored mail keeps only its headers.)" : "(empty body)")}
        </pre>
      </section>

      <section className="rounded-xl border border-stone-200 bg-stone-50 p-5 text-sm space-y-3">
        <h2 className="text-base font-semibold text-stone-800">What the CRM did with it</h2>
        {row.status === "routed" ? (
          <>
            <p className="text-stone-600">
              Made into <b>{ROUTE_WORDS[row.route ?? ""] ?? row.route}</b>
              {row.note ? <> — {row.note}</> : null}.
            </p>
            <ul className="space-y-1">
              {row.log_draft_id ? (
                <li>
                  <Link href={`/log/${row.log_draft_id}`} className="font-medium text-indigo-700 hover:underline">
                    Log draft
                  </Link>{" "}
                  <span className={stateTone(stateWord(draftStatus("log_drafts", row.log_draft_id)))}>· {stateWord(draftStatus("log_drafts", row.log_draft_id))}</span>
                </li>
              ) : null}
              {intakeIds.map((d) => (
                <li key={d}>
                  <Link href={`/intake/${d}`} className="font-medium text-indigo-700 hover:underline">
                    Intake draft
                  </Link>{" "}
                  <span className={stateTone(stateWord(draftStatus("intake_drafts", d)))}>· {stateWord(draftStatus("intake_drafts", d))}</span>
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
          <p className="text-stone-500">
            {row.route === UNKNOWN_SENDER_ROUTE
              ? "Ignored — not sent from one of your addresses, so it wasn't passed to the AI and its text wasn't kept. To accept mail from that address, add it under “Your other email addresses” on the Inbox page, then forward the email again."
              : "Ignored."}
          </p>
        ) : (
          <p className="text-stone-500">Waiting to be routed.</p>
        )}
        <InboxRedo
          id={row.id}
          status={row.status}
          hasText={!!row.body.trim()}
          back="message"
          drafts={[...(row.log_draft_id ? [draftStatus("log_drafts", row.log_draft_id)] : []), ...intakeIds.map((d) => draftStatus("intake_drafts", d))]}
        />
      </section>
    </div>
  );
}
