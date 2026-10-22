"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { markInboxRead, pollInbox, routeMessage, validateInboxAddress } from "./inbox";
import { setSetting } from "./settings";

export async function saveInboxSettings(formData: FormData) {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const addr = validateInboxAddress(str("address"));
  if (!addr.ok) redirect(`/inbox?error=${encodeURIComponent(`The address wasn't saved — ${addr.reason}`)}`);
  const minutes = Number(str("poll_minutes"));
  setSetting("inbox.address", addr.address || null);
  setSetting("inbox.enabled", formData.get("enabled") && addr.address ? "on" : null);
  setSetting("inbox.poll_minutes", minutes >= 10 ? String(Math.round(minutes)) : null);
  setSetting("inbox.extra_owner_emails", str("extra_owner_emails") || null);
  revalidatePath("/inbox");
  redirect("/inbox?saved=1");
}

/** "Check now": one poll, then back to the queue with a one-line result. */
export async function checkInboxNow() {
  const r = await pollInbox();
  revalidatePath("/inbox");
  const msg = r.error
    ? `Check failed — ${r.error}`
    : r.fetched === 0
      ? "Checked — nothing new at the CRM address."
      : `Checked — ${r.routed} new email${r.routed === 1 ? "" : "s"} routed${r.skipped ? ` (${r.skipped} already seen)` : ""}${
          r.ignored ? `; ${r.ignored} from an address that isn't yours, ignored` : ""
        }.`;
  redirect(`/inbox?${r.error ? "error" : "saved"}=${encodeURIComponent(msg)}`);
}

/** The queue, or the message's own page when the form said so (back="message"). */
function backTo(formData: FormData, id: number): string {
  return formData.get("back") === "message" && id ? `/inbox/${id}` : "/inbox";
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

export async function ignoreInboxMessage(formData: FormData) {
  const id = Number(formData.get("id"));
  if (id) getDb().prepare(`UPDATE inbox_messages SET status='ignored', read_at=COALESCE(read_at, datetime('now')) WHERE id=?`).run(id);
  revalidatePath("/inbox");
  redirect(backTo(formData, id));
}

export async function markAllInboxRead() {
  getDb().prepare(`UPDATE inbox_messages SET read_at = datetime('now') WHERE read_at IS NULL`).run();
  revalidatePath("/inbox");
  redirect("/inbox");
}
