import type Database from "better-sqlite3";
import { z } from "zod";
import { getDb } from "./db";
import { buildInboxFetchPrompt, claudeBin, extractJsonWithRepair, runClaudeStream, TOOLS, type InboxFetchedMessage } from "./ai";
import { insertIntakeDraft, insertLogDraft, processIntakeDraft, processLogDraft } from "./drafts";
import { intakeInputFor, logInputFor, ownerAddresses, primaryParticipant, routeEmail, sentByOwner, type InboxEmail, type Participant, type RosterEntry } from "./inboxRoute";
import { loadOwner } from "./owner.mjs";
import { getSetting, setSetting } from "./settings";

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
 * CRM address, inbox.extra_owner_emails) is routed; anything else is stored
 * as ignored with route 'unknown sender' and never reaches the model unless
 * the owner routes it by hand.
 *
 * Settings (key/value, edited on /inbox): inbox.address, inbox.enabled,
 * inbox.poll_minutes, inbox.extra_owner_emails, and the status pair
 * inbox.last_poll_at / inbox.last_error.
 */

export const INBOX_MAX_PER_POLL = 20;
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

const FetchedSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().min(1),
      thread_id: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      subject: z.string().optional(),
      from: z.string().optional(),
      to: z.array(z.string()).optional(),
      cc: z.array(z.string()).optional(),
      body: z.string().optional(),
    })
  ),
});

let polling: Promise<PollResult> | null = null;

export interface PollResult {
  fetched: number;
  routed: number;
  skipped: number;
  /** Not sent from one of the owner's addresses — stored, not routed. */
  ignored: number;
  error: string | null;
}

/** One poll; concurrent callers share the in-flight one. */
export function pollInbox(): Promise<PollResult> {
  if (polling) return polling;
  polling = pollInboxInner().finally(() => {
    polling = null;
  });
  return polling;
}

export function inboxPollRunning(): boolean {
  return polling !== null;
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
  try {
    const since = new Date();
    if (s.lastPollAt) since.setTime(new Date(s.lastPollAt).getTime() - LOOKBACK_DAYS * 86_400_000);
    else since.setTime(since.getTime() - FIRST_LOOKBACK_DAYS * 86_400_000);
    const seen = (db.prepare(`SELECT gmail_id FROM inbox_messages ORDER BY id DESC LIMIT 60`).all() as { gmail_id: string }[]).map(
      (r) => r.gmail_id
    );
    const text = await runClaudeStream(buildInboxFetchPrompt(s.address, gmailDate(since), seen, INBOX_MAX_PER_POLL), {
      allowedTools: TOOLS.gmailRead,
      timeoutMs: 300_000,
    });
    const parsed = FetchedSchema.safeParse(await extractJsonWithRepair(text));
    if (!parsed.success) throw new Error(`Couldn't read the mailbox listing: ${parsed.error.issues[0]?.message ?? "bad JSON"}`);
    const messages: InboxFetchedMessage[] = parsed.data.messages.map((m) => ({
      id: m.id,
      thread_id: m.thread_id ?? null,
      date: m.date && /^\d{4}-\d{2}-\d{2}/.test(m.date) ? m.date.slice(0, 10) : null,
      subject: m.subject ?? "",
      from: m.from ?? "",
      to: m.to ?? [],
      cc: m.cc ?? [],
      body: m.body ?? "",
    }));
    result.fetched = messages.length;
    const owners = inboxOwnerEmails(s);
    for (const m of messages) {
      const stored = storeMessage(db, m);
      if (!stored) {
        result.skipped++;
        continue;
      }
      if (!sentByOwner(m, owners)) {
        db.prepare(`UPDATE inbox_messages SET status='ignored', route=? WHERE id=?`).run(UNKNOWN_SENDER_ROUTE, stored);
        result.ignored++;
        continue;
      }
      routeMessage(db, stored);
      result.routed++;
    }
    setSetting("inbox.last_poll_at", new Date().toISOString());
    setSetting("inbox.last_error", null);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    setSetting("inbox.last_error", result.error);
  }
  return result;
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
  created_at: string;
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
function discardDrafts(db: Database.Database, row: InboxRow): void {
  if (row.log_draft_id) {
    db.prepare(`UPDATE log_drafts SET status='discarded' WHERE id=? AND status IN ('analyzing','ready','error')`).run(row.log_draft_id);
  }
  for (const id of parseIds(row.intake_draft_ids)) {
    db.prepare(`UPDATE intake_drafts SET status='discarded' WHERE id=? AND status IN ('analyzing','ready','error')`).run(id);
  }
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
    const draftId = insertIntakeDraft(db, intakeInputFor(email, person, row.date, owners));
    void processIntakeDraft(draftId, false);
    db.prepare(`UPDATE inbox_messages SET intake_draft_ids=?, pending_people=?, note=? WHERE id=?`).run(
      JSON.stringify([...parseIds(row.intake_draft_ids), draftId]),
      JSON.stringify(pending.filter((p) => p.email !== person.email)),
      [row.note, `Intake: ${person.name ?? person.email}`].filter(Boolean).join(" · "),
      id
    );
    return;
  }

  if (force) discardDrafts(db, row);
  const route = routeEmail(force ? { ...email, subject: `#${force} ${email.subject}` } : email, roster(db), owners);
  const notes: string[] = [];
  let logDraftId: number | null = null;
  const intakeIds: number[] = [];
  let pending: Participant[] = [];

  try {
    if (route.mode === "log" || route.mode === "both") {
      const hint = route.known.length === 1 ? (db.prepare(`SELECT id FROM people WHERE slug=?`).get(route.known[0].slug) as { id: number } | undefined) : undefined;
      logDraftId = insertLogDraft(db, {
        raw: `Email to the CRM address: ${email.subject || "(no subject)"}${route.known.length ? ` — about ${route.known.map((k) => k.name).join(", ")}` : ""}`,
        source: "email",
        content: logInputFor(email, row.date),
        hintPersonId: hint?.id ?? null,
      });
      void processLogDraft(logDraftId);
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
      const draftId = insertIntakeDraft(db, raw);
      intakeIds.push(draftId);
      void processIntakeDraft(draftId, false);
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
      logDraftId,
      intakeIds.length ? JSON.stringify(intakeIds) : null,
      pending.length ? JSON.stringify(pending) : null,
      notes.join(" · "),
      id
    );
  } catch (err) {
    db.prepare(`UPDATE inbox_messages SET status='error', error=? WHERE id=?`).run(err instanceof Error ? err.message : String(err), id);
  }
}

// ---------------------------------------------------------------------------
// Background loop (started from instrumentation.ts)
// ---------------------------------------------------------------------------

let loopTimer: NodeJS.Timeout | null = null;

/**
 * Check the mailbox on a schedule while mail-in is on. The interval is read
 * from settings on every tick, so changes on /inbox apply without a restart.
 */
export function startInboxLoop(): void {
  if (loopTimer) return;
  const tick = async () => {
    try {
      const s = getInboxSettings();
      if (s.enabled && s.address && claudeBin()) {
        const last = s.lastPollAt ? new Date(s.lastPollAt).getTime() : 0;
        if (Date.now() - last >= s.pollMinutes * 60_000 - 5_000) {
          const r = await pollInbox();
          if (r.fetched || r.error) console.log(`[inbox] fetched ${r.fetched}, routed ${r.routed}${r.error ? ` — ${r.error}` : ""}`);
        }
      }
    } catch (err) {
      console.error("[inbox] poll failed:", err);
    }
  };
  loopTimer = setInterval(tick, 60_000);
  loopTimer.unref();
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
  const rows = db
    .prepare(`SELECT * FROM inbox_messages WHERE status <> 'ignored' ORDER BY id DESC LIMIT ?`)
    .all(limit) as InboxRow[];
  const logStatus = db.prepare(`SELECT status FROM log_drafts WHERE id=?`);
  const intakeStatus = db.prepare(`SELECT status FROM intake_drafts WHERE id=?`);
  const out: OpenInboxItem[] = [];
  for (const r of rows) {
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
