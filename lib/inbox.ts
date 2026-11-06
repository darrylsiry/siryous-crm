import type Database from "better-sqlite3";
import { getDb } from "./db";
import { buildInboxFetchPrompt, claudeBin, extractJsonWithRepair, runClaudeStream, TOOLS, type InboxFetchedMessage } from "./ai";
import { discardDraft, insertIntakeDraft, insertLogDraft, processIntakeDraft, processLogDraft } from "./drafts";
import { inboxCheckDue, intakeInputFor, logInputFor, ownerAddresses, primaryParticipant, routeEmail, sentByOwner, stripPlusTag, type InboxEmail, type Participant, type RosterEntry } from "./inboxRoute";
import { loadOwner } from "./owner.mjs";
import { getSetting, setSetting } from "./settings";
import { parseInboxListing } from "./schemas";
import { shared } from "./serverState";

/**
 * Mail-in: a mailbox address the owner forwards or copies emails to. A poll
 * asks Claude (Gmail read tools — the same connector Prep and Log use) for
 * the new messages at that address, then everything else happens locally:
 * the participants are matched against the roster, and each message becomes
 * a Log draft (people already in the CRM), Intake draft(s) (people who
 * aren't), or both. Nothing is written to the roster until the owner
 * confirms the drafts, exactly as with a paste.
 *
 * Only email whose From is one of the owner's addresses (owner.json's, the
 * CRM address, inbox.extra_owner_emails) is routed. The mailbox search itself
 * asks only for mail from those addresses, so other mail isn't fetched; one
 * that slips through anyway is stored as ignored, route 'unknown sender',
 * headers only. Ignored mail is purged after IGNORED_KEEP_DAYS.
 *
 * Settings (key/value, edited on /inbox): inbox.address, inbox.enabled,
 * inbox.poll_minutes, inbox.extra_owner_emails, and the status keys
 * inbox.last_poll_at (last success), inbox.last_attempt_at, inbox.last_error,
 * and inbox.follow_up_at (set by a full check that stored new mail).
 */

export const INBOX_MAX_PER_POLL = 20;
/** A poll only fetches and copies text; a side-by-side run returned the same mail as Sonnet at a fraction of the cost. */
const INBOX_MODEL = "haiku";
/** inbox_messages.route for mail that wasn't sent from one of the owner's addresses. */
export const UNKNOWN_SENDER_ROUTE = "unknown sender";
const MIN_POLL_MINUTES = 10;
const DEFAULT_POLL_MINUTES = 30;
/** How far back a poll looks: from the last successful poll, less this margin (Gmail's after: is day-granular). */
const LOOKBACK_DAYS = 2;
const FIRST_LOOKBACK_DAYS = 7;

export interface InboxSettings {
  address: string;
  enabled: boolean;
  pollMinutes: number;
  extraOwnerEmails: string[];
  lastPollAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export function getInboxSettings(): InboxSettings {
  const minutes = Number(getSetting("inbox.poll_minutes"));
  return {
    address: (getSetting("inbox.address") ?? "").trim(),
    enabled: getSetting("inbox.enabled") === "on",
    pollMinutes: minutes >= MIN_POLL_MINUTES ? Math.round(minutes) : DEFAULT_POLL_MINUTES,
    extraOwnerEmails: (getSetting("inbox.extra_owner_emails") ?? "")
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean),
    lastPollAt: getSetting("inbox.last_poll_at"),
    // Installs from before this key existed fall back to the last success.
    lastAttemptAt: getSetting("inbox.last_attempt_at") ?? getSetting("inbox.last_poll_at"),
    lastError: getSetting("inbox.last_error"),
  };
}

export function validateInboxAddress(raw: string): { ok: true; address: string } | { ok: false; reason: string } {
  const address = raw.trim().toLowerCase();
  if (!address) return { ok: true, address: "" };
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address)) return { ok: false, reason: "that isn't an email address" };
  return { ok: true, address };
}

/** All addresses that mean "the owner" for routing purposes. */
export function inboxOwnerEmails(s: InboxSettings = getInboxSettings()): string[] {
  return ownerAddresses(loadOwner().ownerEmail, s.address, s.extraOwnerEmails);
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/** Ignored mail (headers only) is deleted after this many days. */
const IGNORED_KEEP_DAYS = 30;

/** Delete ignored mail older than IGNORED_KEEP_DAYS: it was never wanted. */
export function purgeIgnoredMail(db: Database.Database = getDb()): number {
  return db.prepare(`DELETE FROM inbox_messages WHERE status='ignored' AND created_at < datetime('now', ?)`).run(`-${IGNORED_KEEP_DAYS} days`).changes;
}

/** After a capped check that stored new mail, the next one runs this soon (the loop ticks every minute). */
const FOLLOW_UP_MS = 2 * 60_000;
/** Ids sent as "already recorded" in the fetch prompt, at most. */
const MAX_SEEN_IDS = 500;

const state = shared("inbox", () => ({ polling: null as Promise<PollResult> | null, loopTimer: null as NodeJS.Timeout | null }));

export interface PollResult {
  fetched: number;
  routed: number;
  skipped: number;
  /** Not sent from one of the owner's addresses — stored, not routed. */
  ignored: number;
  error: string | null;
  /** The check stored new mail and returned as many messages as it may: more may be waiting, and a follow-up check fetches them. */
  capped?: boolean;
  /** Messages in the listing that couldn't be read (no id, say) and were left out. */
  dropped?: number;
}

/** One poll; concurrent callers share the in-flight one. */
export function pollInbox(): Promise<PollResult> {
  if (state.polling) return state.polling;
  state.polling = pollInboxInner().finally(() => {
    state.polling = null;
  });
  return state.polling;
}

export function inboxPollRunning(): boolean {
  return state.polling !== null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function gmailDate(d: Date): string {
  return isoDate(d).replace(/-/g, "/");
}

async function pollInboxInner(): Promise<PollResult> {
  const db = getDb();
  const s = getInboxSettings();
  const result: PollResult = { fetched: 0, routed: 0, skipped: 0, ignored: 0, error: null };
  if (!s.address) {
    result.error = "No CRM address is set.";
    return result;
  }
  if (!claudeBin()) {
    result.error = "The Claude tool isn't installed, so the mailbox can't be read (see “If you use Claude” in the README).";
    setSetting("inbox.last_error", result.error);
    return result;
  }
  setSetting("inbox.last_attempt_at", new Date().toISOString());
  setSetting("inbox.follow_up_at", null);
  purgeIgnoredMail(db);
  try {
    const since = new Date();
    if (s.lastPollAt) since.setTime(new Date(s.lastPollAt).getTime() - LOOKBACK_DAYS * 86_400_000);
    else since.setTime(since.getTime() - FIRST_LOOKBACK_DAYS * 86_400_000);
    // Everything already stored from inside the look-back window, so a window
    // holding more mail than one check returns still moves on to the rest.
    const seen = (
      db
        .prepare(`SELECT gmail_id FROM inbox_messages WHERE COALESCE(date, substr(created_at, 1, 10)) >= ? ORDER BY id DESC LIMIT ?`)
        .all(isoDate(since), MAX_SEEN_IDS) as { gmail_id: string }[]
    ).map((r) => r.gmail_id);
    let reachedGmail = false;
    // The owner's addresses, with and without plus-tags, filter the search itself.
    const fromAddrs = [...new Set(inboxOwnerEmails(s).flatMap((e) => [e, stripPlusTag(e)]))];
    const text = await runClaudeStream(buildInboxFetchPrompt(s.address, gmailDate(since), seen, INBOX_MAX_PER_POLL, fromAddrs), {
      model: INBOX_MODEL,
      allowedTools: TOOLS.gmailRead,
      timeoutMs: 300_000,
      onEvent: (e) => {
        if (e.t === "gmail") reachedGmail = true;
      },
    });
    // Without this, a model that couldn't reach Gmail can look like an empty
    // mailbox: its explanation may quote {"messages": []}, which parses fine.
    if (!reachedGmail) throw new Error("The check never reached Gmail, so nothing was fetched. Is the Gmail connector still connected in Claude?");
    const listing = parseInboxListing(await extractJsonWithRepair(text));
    if (!listing) throw new Error(`Couldn't read the mailbox listing: the answer had no "messages" list.`);
    const messages: InboxFetchedMessage[] = listing.messages.map((m) => ({
      ...m,
      date: m.date && /^\d{4}-\d{2}-\d{2}/.test(m.date) ? m.date.slice(0, 10) : null,
    }));
    result.fetched = messages.length;
    if (listing.dropped) result.dropped = listing.dropped;
    const owners = inboxOwnerEmails(s);
    for (const m of messages) {
      const stored = storeMessage(db, m);
      if (!stored) {
        result.skipped++;
        continue;
      }
      if (!sentByOwner(m, owners)) {
        // A stranger's message: keep the headers (so it isn't fetched again), not its text.
        db.prepare(`UPDATE inbox_messages SET status='ignored', route=?, body='' WHERE id=?`).run(UNKNOWN_SENDER_ROUTE, stored);
        result.ignored++;
        continue;
      }
      routeMessage(db, stored);
      result.routed++;
    }
    const full = messages.length + (listing.dropped ?? 0) >= INBOX_MAX_PER_POLL;
    const storedNew = result.routed + result.ignored;
    result.capped = full && storedNew > 0;
    if (result.capped) {
      // Oldest first and full: there may be more waiting. Keep the look-back
      // where it was (what was stored is now in the skip list) and check again
      // shortly rather than a full interval later. Each follow-up only happens
      // after one that stored something, so it can't spin on old mail.
      setSetting("inbox.follow_up_at", new Date(Date.now() + FOLLOW_UP_MS).toISOString());
    } else if (full) {
      // A full answer of mail already stored (the model ignored the skip list):
      // move the look-back up to the newest of it instead of asking again.
      // With no dates to go by it stays put, rather than jumping to now and
      // skipping mail in the window that was never fetched.
      const past = lookBackPast(messages, s.lastPollAt);
      if (!past) throw new Error("Gmail's answer gave no dates for its messages, so the next check looks back from the same point instead of skipping ahead.");
      setSetting("inbox.last_poll_at", past.toISOString());
    } else {
      setSetting("inbox.last_poll_at", new Date().toISOString());
    }
    setSetting("inbox.last_error", null);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    setSetting("inbox.last_error", result.error);
  }
  return result;
}

/**
 * The last_poll_at that makes the next look-back start at the newest of these
 * messages' dates (never earlier than it already is, never in the future);
 * null when none of them has a date.
 */
function lookBackPast(messages: InboxFetchedMessage[], lastPollAt: string | null): Date | null {
  const now = Date.now();
  const newest = messages.map((m) => m.date).filter((d): d is string => !!d).sort().at(-1);
  if (!newest) return null;
  let t = Date.parse(`${newest}T00:00:00Z`) + LOOKBACK_DAYS * 86_400_000;
  const current = Date.parse(lastPollAt ?? "");
  if (Number.isFinite(current)) t = Math.max(t, current);
  return new Date(Math.min(t, now));
}

/** Insert the message if it is new; null when it was seen before or is empty. */
function storeMessage(db: Database.Database, m: InboxFetchedMessage): number | null {
  if (!m.body.trim() && !m.subject.trim()) return null;
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO inbox_messages (gmail_id, thread_id, subject, sender, recipients, date, body, status)
       VALUES (?,?,?,?,?,?,?,'new')`
    )
    .run(m.id, m.thread_id, m.subject, m.from, JSON.stringify({ to: m.to, cc: m.cc }), m.date, m.body);
  return r.changes ? Number(r.lastInsertRowid) : null;
}

// ---------------------------------------------------------------------------
// Routing a stored message into drafts
// ---------------------------------------------------------------------------

export interface InboxRow {
  id: number;
  gmail_id: string;
  thread_id: string | null;
  subject: string | null;
  sender: string | null;
  recipients: string | null;
  date: string | null;
  body: string;
  status: string;
  route: string | null;
  log_draft_id: number | null;
  intake_draft_ids: string | null;
  pending_people: string | null;
  note: string | null;
  error: string | null;
  read_at: string | null;
  created_at: string;
}

/** Opening an email (or acting on it) clears it from the Inbox unread badge. */
export function markInboxRead(id: number, db: Database.Database = getDb()): void {
  db.prepare(`UPDATE inbox_messages SET read_at = datetime('now') WHERE id=? AND read_at IS NULL`).run(id);
}

export function loadInboxRow(db: Database.Database, id: number): InboxRow | undefined {
  return db.prepare(`SELECT * FROM inbox_messages WHERE id=?`).get(id) as InboxRow | undefined;
}

export function emailOf(row: InboxRow): InboxEmail {
  let to: string[] = [];
  let cc: string[] = [];
  try {
    const r = JSON.parse(row.recipients ?? "{}");
    to = Array.isArray(r.to) ? r.to : [];
    cc = Array.isArray(r.cc) ? r.cc : [];
  } catch {}
  return { subject: row.subject ?? "", from: row.sender ?? "", to, cc, body: row.body };
}

function roster(db: Database.Database): RosterEntry[] {
  return db.prepare(`SELECT slug, name, email FROM people ORDER BY name`).all() as RosterEntry[];
}

/**
 * Discard the drafts an earlier routing of this message created (unless they
 * were already confirmed), so a re-route doesn't leave duplicates — and a
 * discarded draft's queued model run is skipped (see lib/drafts.ts).
 */
export function discardDrafts(db: Database.Database, row: InboxRow): number {
  let n = 0;
  if (row.log_draft_id) {
    n += discardDraft(db, "log", row.log_draft_id, ["analyzing", "ready", "error"]);
  }
  for (const id of parseIds(row.intake_draft_ids)) {
    n += discardDraft(db, "intake", id, ["analyzing", "ready", "error"]);
  }
  return n;
}

export function parseIds(json: string | null): number[] {
  try {
    const v = json ? JSON.parse(json) : [];
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

export function parsePeople(json: string | null): Participant[] {
  try {
    const v = json ? JSON.parse(json) : [];
    return Array.isArray(v) ? v.filter((p) => p && typeof p.email === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Decide where a message goes and start the draft(s). `force` re-routes a
 * message by hand from the queue (→ Log / → Intake), replacing the drafts
 * the previous routing made; `who` (an address) intakes one specific person
 * from the "also on this email" list without touching the other drafts.
 */
export function routeMessage(db: Database.Database, id: number, force: "log" | "intake" | null = null, who: string | null = null): void {
  const row = loadInboxRow(db, id);
  if (!row) return;
  const email = emailOf(row);
  const owners = inboxOwnerEmails();

  // Add one more person from the email (no re-route).
  if (who) {
    const pending = parsePeople(row.pending_people);
    const person = pending.find((p) => p.email === who.toLowerCase());
    if (!person) return;
    const draftId = insertIntakeDraft(db, intakeInputFor(email, person, row.date, owners), "inbox");
    db.prepare(`UPDATE inbox_messages SET intake_draft_ids=?, pending_people=?, note=? WHERE id=?`).run(
      JSON.stringify([...parseIds(row.intake_draft_ids), draftId]),
      JSON.stringify(pending.filter((p) => p.email !== person.email)),
      [row.note, `Intake: ${person.name ?? person.email}`].filter(Boolean).join(" · "),
      id
    );
    void processIntakeDraft(draftId, false);
    return;
  }

  // Saved drafts stay linked to their email through a redo, and a saved Log
  // draft is never made again: that would log the same email twice.
  const draftStatus = (table: "log_drafts" | "intake_drafts", draftId: number) =>
    (db.prepare(`SELECT status FROM ${table} WHERE id=?`).get(draftId) as { status: string } | undefined)?.status;
  const savedLog = row.log_draft_id && draftStatus("log_drafts", row.log_draft_id) === "confirmed" ? row.log_draft_id : null;
  const savedIntakes = force ? parseIds(row.intake_draft_ids).filter((d) => draftStatus("intake_drafts", d) === "confirmed") : [];
  if (force === "log" && savedLog) return;
  if (force) discardDrafts(db, row);
  const route = routeEmail(email, roster(db), owners, force);
  const notes: string[] = [];
  let logDraftId: number | null = null;
  const intakeIds: number[] = [...savedIntakes];
  let pending: Participant[] = [];
  // Drafts start only once the email row records them (and each carries origin "inbox" anyway).
  const starts: (() => Promise<void>)[] = [];

  try {
    if ((route.mode === "log" || route.mode === "both") && !savedLog) {
      const hint = route.known.length === 1 ? (db.prepare(`SELECT id FROM people WHERE slug=?`).get(route.known[0].slug) as { id: number } | undefined) : undefined;
      logDraftId = insertLogDraft(db, {
        raw: `Email to the CRM address: ${email.subject || "(no subject)"}${route.known.length ? ` — about ${route.known.map((k) => k.name).join(", ")}` : ""}`,
        source: "email",
        content: logInputFor(email, row.date),
        hintPersonId: hint?.id ?? null,
        origin: "inbox",
      });
      const started = logDraftId;
      starts.push(() => processLogDraft(started));
      notes.push(route.known.length ? `Log: ${route.known.map((k) => k.name).join(", ")}` : "Log: nobody matched by address — the model will look for roster names in the text");
    }
    if (route.mode === "intake" || route.mode === "both") {
      // One Intake, for the person the email is about (the forwarded
      // message's sender, usually). Each Intake is a full model run, so the
      // other unknown people are listed on the queue with an "add" button
      // instead of being drafted unasked. With nobody identifiable, one
      // draft from the whole email.
      const primary = primaryParticipant(email, route.unknown);
      const raw = primary ? intakeInputFor(email, primary, row.date, owners) : `Email subject: ${email.subject}\nFrom: ${email.from}\n\n${email.body}`;
      const draftId = insertIntakeDraft(db, raw, "inbox");
      intakeIds.push(draftId);
      starts.push(() => processIntakeDraft(draftId, false));
      pending = route.unknown.filter((p) => p.email !== primary?.email);
      notes.push(`Intake: ${primary ? (primary.name ?? primary.email) : "from the email text"}`);
    } else {
      // Log only: anyone unknown can still be added by hand.
      pending = route.unknown;
    }
    db.prepare(
      `UPDATE inbox_messages SET status='routed', route=?, log_draft_id=?, intake_draft_ids=?, pending_people=?, note=?, error=NULL WHERE id=?`
    ).run(
      route.forced ? `${route.mode} (tagged)` : route.mode,
      logDraftId ?? savedLog,
      intakeIds.length ? JSON.stringify(intakeIds) : null,
      pending.length ? JSON.stringify(pending) : null,
      notes.join(" · "),
      id
    );
    for (const start of starts) void start();
  } catch (err) {
    db.prepare(`UPDATE inbox_messages SET status='error', error=? WHERE id=?`).run(err instanceof Error ? err.message : String(err), id);
  }
}

// ---------------------------------------------------------------------------
// Background loop (started from instrumentation.ts)
// ---------------------------------------------------------------------------

/**
 * Check the mailbox on a schedule while mail-in is on (see inboxCheckDue). The
 * interval is read from settings on every tick, so changes on /inbox apply
 * without a restart.
 */
export function startInboxLoop(): void {
  if (state.loopTimer) return;
  const tick = async () => {
    try {
      const s = getInboxSettings();
      if (s.enabled && s.address && claudeBin()) {
        const due = inboxCheckDue({
          now: Date.now(),
          lastAttemptAt: s.lastAttemptAt,
          lastActiveAt: getSetting("app.last_active_at"),
          pollMinutes: s.pollMinutes,
          followUpAt: getSetting("inbox.follow_up_at"),
        });
        if (due) {
          const r = await pollInbox();
          if (r.fetched || r.error) console.log(`[inbox] fetched ${r.fetched}, routed ${r.routed}${r.error ? ` — ${r.error}` : ""}`);
        }
      }
    } catch (err) {
      console.error("[inbox] poll failed:", err);
    }
  };
  state.loopTimer = setInterval(tick, 60_000);
  state.loopTimer.unref();
  // First check shortly after boot rather than a full interval later.
  setTimeout(tick, 15_000).unref();
}

const OPEN_DRAFT = new Set(["pending", "analyzing", "ready", "error"]);

export interface OpenInboxItem {
  id: number;
  subject: string | null;
  sender: string | null;
  date: string;
  /** ready = a draft awaits review; working = the model is still on it; error = a draft or the routing failed; unrouted = not routed yet. */
  state: "ready" | "working" | "error" | "unrouted";
  /** Where a click should go: the first ready draft's review page, else the email. */
  href: string;
}

/**
 * Emails still needing the owner (Dashboard): not ignored, and either not
 * routed yet, failed to route, or with a draft that hasn't been confirmed
 * or discarded. Newest first.
 */
export function openInboxItems(limit = 100): OpenInboxItem[] {
  const db = getDb();
  // Filter to what is still open in SQL, then apply the limit: resolved mail
  // mustn't crowd out an older open one. Headers only: this runs on every
  // sidebar refresh, and a stored body can be 100,000 characters.
  const openDraft = `(${[...OPEN_DRAFT].map((st) => `'${st}'`).join(",")})`;
  const rows = db
    .prepare(
      `SELECT m.id, m.subject, m.sender, m.date, m.created_at, m.status, m.log_draft_id, m.intake_draft_ids
       FROM inbox_messages m
       WHERE m.status <> 'ignored' AND (
         m.status <> 'routed'
         OR EXISTS (SELECT 1 FROM log_drafts d WHERE d.id = m.log_draft_id AND d.status IN ${openDraft})
         OR EXISTS (
           SELECT 1 FROM json_each(CASE WHEN json_valid(m.intake_draft_ids) THEN m.intake_draft_ids ELSE '[]' END) j
           JOIN intake_drafts d ON d.id = j.value
           WHERE d.status IN ${openDraft}
         )
       )
       ORDER BY m.id DESC LIMIT ?`
    )
    .all(limit) as Pick<InboxRow, "id" | "subject" | "sender" | "date" | "created_at" | "status" | "log_draft_id" | "intake_draft_ids">[];
  const logStatus = db.prepare(`SELECT status FROM log_drafts WHERE id=?`);
  const intakeStatus = db.prepare(`SELECT status FROM intake_drafts WHERE id=?`);
  const out: OpenInboxItem[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    const base = { id: r.id, subject: r.subject, sender: r.sender, date: r.date ?? r.created_at.slice(0, 10) };
    if (r.status === "error") {
      out.push({ ...base, state: "error", href: `/inbox/${r.id}` });
      continue;
    }
    if (r.status !== "routed") {
      out.push({ ...base, state: "unrouted", href: `/inbox/${r.id}` });
      continue;
    }
    const drafts: { kind: "log" | "intake"; id: number; status: string }[] = [];
    if (r.log_draft_id) {
      const s = logStatus.get(r.log_draft_id) as { status: string } | undefined;
      if (s) drafts.push({ kind: "log", id: r.log_draft_id, status: s.status });
    }
    for (const id of parseIds(r.intake_draft_ids)) {
      const s = intakeStatus.get(id) as { status: string } | undefined;
      if (s) drafts.push({ kind: "intake", id, status: s.status });
    }
    const open = drafts.filter((d) => OPEN_DRAFT.has(d.status));
    if (!open.length) continue;
    const ready = open.find((d) => d.status === "ready");
    if (ready) out.push({ ...base, state: "ready", href: `/${ready.kind}/${ready.id}` });
    else if (open.some((d) => d.status === "error")) out.push({ ...base, state: "error", href: `/inbox/${r.id}` });
    else out.push({ ...base, state: "working", href: `/${open[0].kind}/${open[0].id}` });
  }
  return out;
}
