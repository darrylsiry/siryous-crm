import Link from "next/link";
import { getDb } from "@/lib/db";
import { getAiStatus } from "@/lib/aiStatus";
import { getInboxSettings, inboxPollRunning, parseIds, parsePeople, type InboxRow } from "@/lib/inbox";
import { localQueueDepth } from "@/lib/llm";
import { readProgress } from "@/lib/progress";
import { cleanSubject } from "@/lib/inboxRoute";
import { checkInboxNow, ignoreInboxMessage, rerouteInboxMessage, saveInboxSettings } from "@/lib/inboxActions";
import { loadOwner } from "@/lib/owner.mjs";
import PendingButton from "@/components/PendingButton";
import FlashBanner from "@/components/FlashBanner";

export const dynamic = "force-dynamic";

const h2 = "text-base font-semibold text-stone-800";
const label = "block text-sm font-medium text-stone-700";
const input = "mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none";
const smallBtn = "rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50";

/** Suggest "you+crm@…" from the owner's address when nothing is set yet. */
function suggestedAddress(ownerEmail: string | null | undefined): string {
  const m = (ownerEmail ?? "").match(/^([^+@]+)@(.+)$/);
  return m ? `${m[1]}+crm@${m[2]}` : "";
}

/**
 * A draft's status word, with the queue position while it waits for the
 * local model ("queued, 2 ahead") — taken from the last progress event.
 */
function draftStatus(kind: "log" | "intake", id: number): string {
  const p = readProgress(kind, id);
  if (!p) return "gone";
  if (p.status !== "analyzing") return p.status;
  const last = [...p.events].reverse().find((e) => e.t === "info");
  const m = last?.label.match(/^Queued — (\d+) runs? ahead/);
  if (m) return `queued, ${m[1]} ahead`;
  if (last?.label.startsWith("Waiting for the local model")) return "queued, 1 ahead";
  return "analyzing";
}

function StatusWord({ status }: { status: string }) {
  const cls =
    status === "error"
      ? "text-red-600"
      : status === "analyzing" || status.startsWith("queued")
        ? "animate-pulse text-indigo-600"
        : status === "ready"
          ? "text-green-700"
          : "text-stone-500";
  return <span className={cls}>[{status}]</span>;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const ai = await getAiStatus();
  const s = getInboxSettings();
  const owner = loadOwner();
  const running = inboxPollRunning();
  const queued = localQueueDepth();
  const rows = getDb()
    .prepare(`SELECT * FROM inbox_messages ORDER BY id DESC LIMIT 40`)
    .all() as InboxRow[];

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">📥 Inbox</h1>
        <p className="mt-1 text-sm text-stone-500">
          Forward an email to your CRM address — or copy the address on one you send — and it turns into a Log draft for
          the people already in your roster, an Intake draft for anyone new, or both. Same review screens as a paste;
          nothing is saved until you confirm.
        </p>
      </header>

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

      <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={h2}>Queue</h2>
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
        <p className="text-xs text-stone-400">
          {s.enabled && s.address ? (
            <>
              Checking <code>{s.address}</code> every {s.pollMinutes} minutes
              {s.lastPollAt ? <> · last check {new Date(s.lastPollAt).toLocaleString()}</> : <> · not checked yet</>}.
            </>
          ) : s.address ? (
            <>Automatic checks are off — use &ldquo;Check now&rdquo; or turn them on below.</>
          ) : (
            <>No CRM address yet — set one below.</>
          )}
          {s.lastError ? <span className="block text-red-700">Last check failed: {s.lastError}</span> : null}
          {queued > 0 ? (
            <span className="block text-indigo-700">
              The local model is working through {queued} run{queued === 1 ? "" : "s"} — each Intake or Log draft is one run, one at a time.
            </span>
          ) : null}
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing has arrived yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {rows.map((r) => {
              const intakeIds = parseIds(r.intake_draft_ids);
              const pending = parsePeople(r.pending_people);
              return (
                <li key={r.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-stone-800">{cleanSubject(r.subject ?? "") || "(no subject)"}</span>
                    <span className="text-xs text-stone-400">
                      {r.date ?? r.created_at.slice(0, 10)} · {r.sender}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {r.status === "routed" ? (
                      <>
                        {r.log_draft_id ? (
                          <span>
                            <Link href={`/log/${r.log_draft_id}`} className="font-medium text-indigo-700 hover:underline">
                              Log draft #{r.log_draft_id}
                            </Link>{" "}
                            <StatusWord status={draftStatus("log", r.log_draft_id)} />
                          </span>
                        ) : null}
                        {intakeIds.map((id) => (
                          <span key={id}>
                            <Link href={`/intake/${id}`} className="font-medium text-indigo-700 hover:underline">
                              Intake draft #{id}
                            </Link>{" "}
                            <StatusWord status={draftStatus("intake", id)} />
                          </span>
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
                      <span className="text-stone-400">Ignored</span>
                    ) : (
                      <span className="text-stone-500">Waiting to be routed</span>
                    )}
                    <span className="ml-auto flex items-center gap-1.5">
                      <form action={rerouteInboxMessage}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="as" value="log" />
                        <button className={smallBtn} title="Replace the drafts made for this email with a Log draft">
                          → Log
                        </button>
                      </form>
                      <form action={rerouteInboxMessage}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="as" value="intake" />
                        <button className={smallBtn} title="Replace the drafts made for this email with an Intake for the sender">
                          → Intake
                        </button>
                      </form>
                      {r.status !== "ignored" ? (
                        <form action={ignoreInboxMessage}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className={`${smallBtn} text-stone-400`} title="Leave this one out">
                            ✕
                          </button>
                        </form>
                      ) : null}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form action={saveInboxSettings} className="space-y-4">
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
            <span className="mt-1 block text-xs text-stone-400">
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
              <span className="block text-xs text-stone-400">
                Each check is one short Claude run with Gmail read access. Off, &ldquo;Check now&rdquo; still works.
              </span>
            </span>
          </label>
          <label className={label}>
            Minutes between checks
            <input name="poll_minutes" type="number" min={10} step={5} defaultValue={s.pollMinutes} className={`${input} max-w-[8rem]`} />
          </label>
          <label className={label}>
            Your other email addresses
            <input
              name="extra_owner_emails"
              defaultValue={s.extraOwnerEmails.join(", ")}
              placeholder="you@yourfirm.com, you@otherdomain.com"
              className={input}
            />
            <span className="mt-1 block text-xs text-stone-400">
              So they&apos;re never mistaken for a contact when you forward from them. Your address from{" "}
              <code>config/owner.json</code>
              {owner.ownerEmail ? (
                <>
                  {" "}
                  (<code>{owner.ownerEmail}</code>)
                </>
              ) : null}{" "}
              is already excluded.
            </span>
          </label>
          <PendingButton label="Save" pendingLabel="Saving…" pendingNote="" className={smallBtn} />
        </section>
      </form>

      <section className="rounded-xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-600 space-y-2">
        <h2 className={h2}>How routing works</h2>
        <p>
          The people on the email — sender, recipients, and the From/To/Cc lines of a forwarded message — are matched
          against your roster by email address, then by full name. Roster people get a <b>Log</b> draft. If there is
          someone new, the person the email is about (the sender of the forwarded message, usually) gets an{" "}
          <b>Intake</b> draft; anyone else new is listed under &ldquo;Also on this email&rdquo; with a button, since
          every draft is a full run of the local model. Both when the email has both kinds.
        </p>
        <p>
          To decide yourself, put <code>#log</code> or <code>#intake</code> in the subject. Anything you write above a
          forwarded message is passed to the AI as your note (&ldquo;log this on Sam, next step is the proposal&rdquo;).
          A wrong guess can be re-sent with the → Log / → Intake buttons, which replace the drafts made so far for that
          email.
        </p>
      </section>

      <p className="text-xs text-stone-400">
        Reading the mailbox is read-only, using the Gmail access you&apos;ve already given Claude; the routing and the
        drafting happen on this Mac. Back to <Link href="/" className="underline">Dashboard</Link>.
      </p>
    </div>
  );
}
