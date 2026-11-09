import Link from "next/link";
import { getDb } from "@/lib/db";
import { getAiStatus } from "@/lib/aiStatus";
import { getInboxSettings, inboxPollRunning, inboxReading, parseIds, parsePeople, UNKNOWN_SENDER_ROUTE, type InboxRow } from "@/lib/inbox";
import { localQueueDepth } from "@/lib/llm";
import { readProgress } from "@/lib/progress";
import { cleanSubject, INBOX_AWAY_POLL_MINUTES } from "@/lib/inboxRoute";
import { checkInboxNow, markAllInboxRead, rerouteInboxMessage, saveInboxSettings } from "@/lib/inboxActions";
import { getSetting } from "@/lib/settings";
import { stateWord } from "@/lib/stateWords";
import InboxRedo from "@/components/InboxRedo";
import AutoRefresh from "@/components/AutoRefresh";
import AiWhereLine from "@/components/AiWhereLine";
import { INBOX_UNREAD_COND } from "@/lib/navCounts";
import { loadOwner } from "@/lib/owner.mjs";
import PendingButton from "@/components/PendingButton";
import FlashBanner from "@/components/FlashBanner";
import { first, type Param } from "@/lib/params";
import { localStamp, shortDate } from "@/lib/dates.mjs";
import KeepTypedForm from "@/components/KeepTypedForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Inbox" };

const h2 = "text-base font-semibold text-stone-800";
const label = "block text-sm font-medium text-stone-700";
const input = "mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none";
const smallBtn = "rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50";

/** Suggest "you+crm@…" from the owner's address when nothing is set yet. */
function suggestedAddress(ownerEmail: string | null | undefined): string {
  const m = (ownerEmail ?? "").match(/^([^+@]+)@(.+)$/);
  return m ? `${m[1]}+crm@${m[2]}` : "";
}

/** A draft's stored status, and while it's drafting, its place in the local model's queue. */
function draftState(kind: "log" | "intake", id: number): { status: string; ahead: number | null } {
  const p = readProgress(kind, id);
  if (!p) return { status: "gone", ahead: null };
  if (p.status !== "analyzing") return { status: p.status, ahead: null };
  const last = [...p.events].reverse().find((e) => e.t === "info");
  const m = last?.label.match(/^Queued — (\d+) runs? ahead/);
  return { status: "analyzing", ahead: m ? Number(m[1]) : last?.label.startsWith("Waiting for the local model") ? 1 : null };
}

/**
 * The main action for a draft: a button-styled link to its review page.
 * Green and "Review" once the model is done; muted with the queue position
 * while it isn't; red "See error" when it failed (the page says what to do).
 */
function ReviewLink({ kind, id }: { kind: "log" | "intake"; id: number }) {
  const { status, ahead } = draftState(kind, id);
  const href = `/${kind}/${id}`;
  const what = kind === "log" ? "Log" : "Intake";
  const word = stateWord(status);
  if (word === "Ready to review") {
    return (
      <Link href={href} className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700">
        Review the {what} draft →
      </Link>
    );
  }
  if (word === "Failed") {
    return (
      <Link href={href} className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100">
        {what} draft failed — see why →
      </Link>
    );
  }
  if (word === "Drafting") {
    return (
      <Link href={href} className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
        <span className="animate-pulse">
          {what} draft: Drafting{ahead ? ` (${ahead} ahead)` : ""}…
        </span>
      </Link>
    );
  }
  return (
    <Link href={href} className="rounded-md border border-stone-200 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-50">
      {word === "Saved" ? "✓ " : ""}
      {what} draft: {status === "gone" ? "removed" : word}
    </Link>
  );
}

const PAGE_SIZE = 40;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ saved?: Param; error?: Param; page?: Param }> }) {
  const sp = await searchParams;
  const saved = first(sp.saved);
  const error = first(sp.error);
  const page = Math.max(1, Math.floor(Number(first(sp.page))) || 1);
  const ai = await getAiStatus();
  const s = getInboxSettings();
  const owner = loadOwner();
  const running = inboxPollRunning();
  const queued = localQueueDepth();
  const db = getDb();
  const rows = db
    .prepare(`SELECT m.*, (${INBOX_UNREAD_COND}) AS unread FROM inbox_messages m ORDER BY m.id DESC LIMIT ? OFFSET ?`)
    .all(PAGE_SIZE, (page - 1) * PAGE_SIZE) as (InboxRow & { unread: number })[];
  const total = (db.prepare(`SELECT COUNT(*) n FROM inbox_messages`).get() as { n: number }).n;
  // The whole mailbox, as the sidebar badge counts it, not just this page.
  const unreadCount = (db.prepare(`SELECT COUNT(*) n FROM inbox_messages m WHERE ${INBOX_UNREAD_COND}`).get() as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const statusOf = (table: "log_drafts" | "intake_drafts", id: number) =>
    (db.prepare(`SELECT status FROM ${table} WHERE id=?`).get(id) as { status: string } | undefined)?.status ?? "gone";
  const drafting = rows.some(
    (r) =>
      (r.log_draft_id && ["analyzing", "pending"].includes(statusOf("log_drafts", r.log_draft_id))) ||
      parseIds(r.intake_draft_ids).some((id) => ["analyzing", "pending"].includes(statusOf("intake_drafts", id)))
  );
  const reading = rows.some((r) => inboxReading(r.id));
  let lastResult: { at: string; ok: boolean; text: string } | null = null;
  try {
    lastResult = JSON.parse(getSetting("inbox.last_result") ?? "null");
  } catch {}
  const phoneAddress = s.address || suggestedAddress(owner.ownerEmail) || "your CRM address";

  // The address form: first on the page until an address is set, below the queue after.
  const setup = (
      <KeepTypedForm action={saveInboxSettings} className="space-y-4">
      <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-4">
        <h2 className={h2}>Your CRM address</h2>
        <label className={label}>
          Address
          <input
            name="address"
            type="email"
            defaultValue={s.address}
            placeholder={suggestedAddress(owner.ownerEmail) || "you+crm@example.com"}
            className={input}
          />
          <span className="mt-1 block text-xs text-stone-500">
            Gmail delivers anything sent to <code>you<b>+anything</b>@gmail.com</code> to your normal inbox, so{" "}
            <code>{suggestedAddress(owner.ownerEmail) || "you+crm@gmail.com"}</code> needs no setup — it just has to
            be the mailbox your Claude Gmail connector is signed in to. Mail from other addresses you use can be
            forwarded there too.
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="enabled" value="1" defaultChecked={s.enabled} className="mt-1" />
          <span>
            Check automatically
            <span className="block text-xs text-stone-500">
              Each check is one Claude run with Gmail read access, so it checks less often while you&rsquo;re away. Off,
              &ldquo;Check now&rdquo; still works.
            </span>
          </span>
        </label>
        <label className={label}>
          Minutes between checks while you&rsquo;re using the CRM
          <input name="poll_minutes" type="number" min={10} step={5} defaultValue={s.pollMinutes} className={`${input} max-w-[8rem]`} />
        </label>
        <label className={label}>
          Your other email addresses (allowed senders)
          <input
            name="extra_owner_emails"
            defaultValue={s.extraOwnerEmails.join(", ")}
            placeholder="you@yourfirm.com, you@otherdomain.com"
            className={input}
          />
          <span className="mt-1 block text-xs text-stone-500">
            Mail you send from this Gmail account is read by itself. Mail from an address listed here, or from your
            main address if it&rsquo;s a different one, waits in the queue for you to click <b>Read this email</b>,
            because anyone can put your address on an email. Anything else at the CRM address is listed as ignored.
            List every address you forward or copy from, so mail from it isn&rsquo;t ignored or mistaken for a contact.
            {owner.ownerEmail ? (
              <>
                {" "}
                Your main address (<code>{owner.ownerEmail}</code>) already counts as yours.
              </>
            ) : null}
          </span>
        </label>
        <PendingButton label="Save" pendingLabel="Saving…" pendingNote="" className={smallBtn} />
      </section>
    </KeepTypedForm>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">📥 Inbox</h1>
        <p className="mt-1 text-sm text-stone-600">
          Forward an email to your CRM address — or copy the address on one you send — and it turns into a Log draft for
          the people already in your CRM, an Intake draft for anyone new, or both. Same review screens as a paste;
          nothing is saved until you confirm.
        </p>
      </header>
      {drafting || running || reading ? <AutoRefresh seconds={10} /> : null}

      {saved ? (
        <FlashBanner cleanHref="/inbox" className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {saved === "1" ? "Saved." : saved}
        </FlashBanner>
      ) : null}
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p> : null}

      {!ai.claude.ok ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
          Reading the mailbox uses the Claude tool with your Gmail connector, and the Claude tool isn&apos;t installed on
          this Mac. See &ldquo;If you use Claude&rdquo; in the README.
        </p>
      ) : null}

      {s.address ? null : setup}

      <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={h2}>
            Queue
            {unreadCount > 0 ? <span className="ml-2 text-xs font-medium text-red-700">{unreadCount} unread</span> : null}
          </h2>
          <div className="flex items-center gap-2">
          {unreadCount > 0 ? (
            <form action={markAllInboxRead}>
              <button className={smallBtn} title="Clear the unread badge without opening each email">
                Mark all read
              </button>
            </form>
          ) : null}
          <form action={checkInboxNow}>
            <PendingButton
              label={running ? "Checking…" : "Check now"}
              pendingLabel="Checking the mailbox…"
              pendingNote=""
              className={smallBtn}
              disabled={!s.address || !ai.claude.ok || running}
              disabledLabel={!s.address ? "Set an address below first" : "Check now"}
            />
          </form>
          </div>
        </div>
        <p className="text-xs text-stone-500">
          {s.enabled && s.address ? (
            <>
              Checking <code>{s.address}</code> every {s.pollMinutes} minutes while you&rsquo;re using the CRM, every{" "}
              {Math.max(s.pollMinutes, INBOX_AWAY_POLL_MINUTES) / 60} hours otherwise
              {s.lastPollAt ? <> · last check {new Date(s.lastPollAt).toLocaleString()}</> : <> · not checked yet</>}.
            </>
          ) : s.address ? (
            <>Automatic checks are off — use &ldquo;Check now&rdquo; or turn them on below.</>
          ) : (
            <>No CRM address yet — set one below.</>
          )}
          {running ? <span className="block font-medium text-indigo-700">Checking the mailbox now… this page updates by itself.</span> : null}
          {!running && lastResult ? (
            <span className={`block ${lastResult.ok ? "text-stone-600" : "text-red-700"}`}>
              Last &ldquo;Check now&rdquo; ({localStamp(lastResult.at)}): {lastResult.text}
            </span>
          ) : null}
          {s.lastError ? <span className="block text-red-700">Last check failed: {s.lastError}</span> : null}
          {queued > 0 ? (
            <span className="block text-indigo-700">
              The local model is working through {queued} run{queued === 1 ? "" : "s"} — each Intake or Log draft is one run, one at a time.
            </span>
          ) : null}
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-stone-500">{page > 1 ? "No more emails." : "Nothing has arrived yet."}</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {rows.map((r) => {
              const intakeIds = parseIds(r.intake_draft_ids);
              const pending = parsePeople(r.pending_people);
              return (
                <li key={r.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    {r.unread ? <span className="h-2 w-2 shrink-0 self-center rounded-full bg-red-600" title="Unread" /> : null}
                    <Link href={`/inbox/${r.id}`} className={`${r.unread ? "font-semibold text-stone-900" : "font-medium text-stone-800"} hover:text-indigo-700 hover:underline`} title="Open the original email">
                      {r.status === "held" ? "Not read yet" : cleanSubject(r.subject ?? "") || "(no subject)"}
                    </Link>
                    <span className="text-xs text-stone-500">
                      {shortDate(r.date ?? r.created_at)} · {r.sender}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {r.status === "routed" ? (
                      <>
                        {r.log_draft_id ? <ReviewLink kind="log" id={r.log_draft_id} /> : null}
                        {intakeIds.map((id) => (
                          <ReviewLink key={id} kind="intake" id={id} />
                        ))}
                        {r.note ? <span className="text-stone-500">{r.note}</span> : null}
                        {pending.length ? (
                          <span className="flex flex-wrap items-center gap-1.5 text-stone-500">
                            Also on this email:
                            {pending.map((p) => (
                              <form key={p.email} action={rerouteInboxMessage} className="inline">
                                <input type="hidden" name="id" value={r.id} />
                                <input type="hidden" name="who" value={p.email} />
                                <button className={smallBtn} title={`Draft an Intake for ${p.email}`}>
                                  + {p.name ?? p.email}
                                </button>
                              </form>
                            ))}
                          </span>
                        ) : null}
                      </>
                    ) : r.status === "error" ? (
                      <span className="text-red-700">Couldn&apos;t route: {r.error}</span>
                    ) : r.status === "ignored" ? (
                      <span className="text-stone-500">
                        {r.route === UNKNOWN_SENDER_ROUTE
                          ? "Ignored — not sent from one of your addresses (add it under “Your other email addresses”, then forward it again)"
                          : "Ignored"}
                      </span>
                    ) : r.status === "held" ? null : (
                      <span className="text-stone-500">Waiting to be routed</span>
                    )}
                  </div>
                  <div className="mt-1.5">
                    <InboxRedo
                      id={r.id}
                      status={r.status}
                      error={r.error}
                      hasText={!!r.body.trim()}
                      drafts={[
                        ...(r.log_draft_id ? [statusOf("log_drafts", r.log_draft_id)] : []),
                        ...intakeIds.map((id) => statusOf("intake_drafts", id)),
                      ]}
                      logSaved={!!r.log_draft_id && statusOf("log_drafts", r.log_draft_id) === "confirmed"}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {pages > 1 ? (
          <nav aria-label="Older and newer emails" className="flex items-center justify-between border-t border-stone-100 pt-3 text-sm">
            {page > 1 ? (
              <Link href={page === 2 ? "/inbox" : `/inbox?page=${page - 1}`} className="text-indigo-700 hover:underline">
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-stone-500">
              Page {page} of {pages} · {total} emails
            </span>
            {page < pages ? (
              <Link href={`/inbox?page=${page + 1}`} className="text-indigo-700 hover:underline">
                Older →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>

      {s.address ? setup : null}

      <section className="rounded-xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600 space-y-2">
        <h2 className={h2}>How routing works</h2>
        <p>
          The people on the email — sender, recipients, and the From/To/Cc lines of a forwarded message — are matched
          against your contacts by email address, then by full name. People already in your CRM get a <b>Log</b> draft. If there is
          someone new, the person the email is about (the sender of the forwarded message, usually) gets an{" "}
          <b>Intake</b> draft; anyone else new is listed under &ldquo;Also on this email&rdquo; with a button, since
          every draft is a full run of the local model. Both when the email has both kinds.
        </p>
        <p>
          To decide yourself, put <code>#log</code> or <code>#intake</code> in the subject. Anything you write above a
          forwarded message is passed to the AI as your note (&ldquo;log this on Sam, next step is the proposal&rdquo;).
          When a draft is ready, <b>Review</b> opens the usual review screen — nothing is saved until you confirm
          there. &ldquo;Wrong guess? More&rdquo; can redo an email as Log or Intake (it discards that email&apos;s unsaved
          drafts and runs the model again) or ignore it; it isn&apos;t offered once the email&apos;s drafts are saved.
        </p>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-700 space-y-2">
        <h2 className={h2}>From your phone</h2>
        <p>
          The CRM runs on this Mac, so its pages don&apos;t open on your phone. To log something between meetings, email{" "}
          <code>{phoneAddress}</code> from your phone, e.g. <i>&ldquo;#log Called Sam. Next step: proposal Friday.&rdquo;</i> It waits
          here as a draft to review when you&apos;re back at the Mac.
        </p>
        <p className="text-xs text-stone-500">
          The mailbox is checked every {s.pollMinutes} minutes while you use the CRM ({Math.max(s.pollMinutes, INBOX_AWAY_POLL_MINUTES) / 60} hours
          otherwise), and drafting needs this Mac to be on and awake. Send it from your Gmail account: from another
          address, it waits for you to click <b>Read this email</b>.
        </p>
      </section>

      <p className="text-xs text-stone-500">
        Reading the mailbox is read-only, using the Gmail access you&apos;ve already given Claude; the routing happens on this Mac.
      </p>
      <AiWhereLine extra=" when it drafts" />
    </div>
  );
}
