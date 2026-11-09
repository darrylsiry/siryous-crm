"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "./db";
import { discardDrafts, inboxPollRunning, loadInboxRow, markInboxRead, pollInbox, readHeldMessage, routeMessage, validateInboxAddress, type PollResult } from "./inbox";
import { setSetting } from "./settings";
import type { FormResult } from "./actions";

export async function saveInboxSettings(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const addr = validateInboxAddress(str("address"));
  if (!addr.ok) return { ok: false, message: `The address wasn't accepted: ${addr.reason}` };
  const minutes = Number(str("poll_minutes"));
  setSetting("inbox.address", addr.address || null);
  setSetting("inbox.enabled", formData.get("enabled") && addr.address ? "on" : null);
  setSetting("inbox.poll_minutes", minutes >= 10 ? String(Math.round(minutes)) : null);
  setSetting("inbox.extra_owner_emails", str("extra_owner_emails") || null);
  revalidatePath("/inbox");
  redirect("/inbox?saved=1");
}

/**
 * "Check now": start one poll in the background (it can take a few minutes)
 * and go straight back to the queue, which refreshes itself while the check
 * runs and then shows its one-line result (inbox.last_result).
 */
export async function checkInboxNow() {
  if (!inboxPollRunning()) {
    after(async () => {
      const r = await pollInbox();
      setSetting("inbox.last_result", JSON.stringify({ at: new Date().toISOString(), ok: !r.error, text: pollMessage(r) }));
    });
  }
  redirect(`/inbox?saved=${encodeURIComponent("Checking the mailbox — this can take a few minutes. You can leave this page; new drafts show up here.")}`);
}

function pollMessage(r: PollResult): string {
  return r.error
    ? `Check failed — ${r.error}`
    : r.fetched === 0
      ? "Checked — nothing new at the CRM address."
      : `Checked — ${r.routed} new email${r.routed === 1 ? "" : "s"} routed${r.skipped ? ` (${r.skipped} already seen)` : ""}${
          r.ignored ? `; ${r.ignored} from an address that isn't yours, ignored` : ""
        }${r.held ? `; ${r.held} waiting for you to read, below` : ""}.${r.dropped ? ` ${r.dropped} more couldn't be read and were left out.` : ""}${
          r.capped ? " That's as many as one check takes: the rest come in on a follow-up check in a few minutes." : ""
        }`;
}

/** The queue, or the message's own page when the form said so (back="message"). */
function backTo(formData: FormData, id: number): string {
  return formData.get("back") === "message" && id ? `/inbox/${id}` : "/inbox";
}

/**
 * "Read this email": the owner's go-ahead to read one held message. It starts
 * here and carries on in the background, so the page it returns to already
 * shows it being read. readHeldMessage records its own failures.
 */
export async function readInboxMessage(formData: FormData) {
  const id = Number(formData.get("id"));
  if (id) {
    markInboxRead(id);
    void readHeldMessage(id);
  }
  revalidatePath("/inbox");
  // No banner: it would outlast the reading. The email's own line says it's being read, then shows its draft.
  redirect(backTo(formData, id));
}

/** Re-route one message by hand (a wrong guess, or an error after a retry). */
export async function rerouteInboxMessage(formData: FormData) {
  const id = Number(formData.get("id"));
  const as = String(formData.get("as") ?? "");
  const who = String(formData.get("who") ?? "").trim() || null;
  if (id) markInboxRead(id);
  if (id && who) routeMessage(getDb(), id, null, who);
  else if (id && (as === "log" || as === "intake")) routeMessage(getDb(), id, as);
  revalidatePath("/inbox");
  redirect(backTo(formData, id));
}

/** Leave an email out, and discard its drafts that weren't saved, so none of them keeps asking for review. */
export async function ignoreInboxMessage(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  const row = id ? loadInboxRow(db, id) : undefined;
  let discarded = 0;
  if (row) {
    discarded = db.transaction(() => {
      const n = discardDrafts(db, row);
      // Ignored means not wanted: keep the headers, drop the text.
      db.prepare(`UPDATE inbox_messages SET status='ignored', body='', read_at=COALESCE(read_at, datetime('now')) WHERE id=?`).run(id);
      return n;
    })();
  }
  revalidatePath("/", "layout");
  const back = backTo(formData, id);
  redirect(`${back}?saved=${encodeURIComponent(`Ignored.${discarded ? ` ${discarded} draft${discarded === 1 ? "" : "s"} discarded.` : ""}`)}`);
}

export async function markAllInboxRead() {
  getDb().prepare(`UPDATE inbox_messages SET read_at = datetime('now') WHERE read_at IS NULL`).run();
  revalidatePath("/inbox");
  redirect("/inbox");
}
