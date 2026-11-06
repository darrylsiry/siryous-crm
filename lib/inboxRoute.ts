/**
 * Mail-in routing: given one email that reached the CRM address, decide
 * whether it is an update on people already in the roster (→ Log), a new
 * person to add (→ Intake), or both. Pure functions — no database, no model —
 * so the rules are unit-tested and the poller stays thin.
 *
 * Who took part is read from the message headers AND from any forwarded
 * header block in the body ("From: Jane Doe <jane@acme.com>" lines), because
 * a forwarded email's own headers only say that the owner sent it to the CRM.
 */

export interface InboxEmail {
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  body: string;
}

export interface RosterEntry {
  slug: string;
  name: string;
  email: string | null;
}

export interface Participant {
  name: string | null;
  email: string;
}

export interface Route {
  /** 'log' | 'intake' | 'both' */
  mode: "log" | "intake" | "both";
  /** Roster people found among the participants (or named in the text). */
  known: { slug: string; name: string }[];
  /** Participants who are not in the roster (and are not the owner). */
  unknown: Participant[];
  /** A #log / #intake tag in the subject forced the decision. */
  forced: "log" | "intake" | null;
}

/** "Name <a@b.c>" or "a@b.c" or "Name (a@b.c)", as mail clients render them. */
const ADDR_RE = /(?:"?([^"<,;()]*?)"?\s*[<(]\s*)?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*[>)]?/g;
/** A header line in a forwarded/quoted block: optional quote marks, optional bold, From/To/Cc. */
const FWD_HEADER_RE = /^[>\s*_]*(?:\*\*)?(from|to|cc|reply-to)(?:\*\*)?\s*:\s*(.+)$/i;

/** Addresses that never count as a participant (auto-senders, the CRM itself). */
const NOISE_RE = /^(no-?reply|noreply|do-?not-?reply|mailer-daemon|notifications?|calendar-notification|bounce)/i;

function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

/** "jane+crm@example.com" → "jane@example.com" so any plus-tag of an owner address counts as the owner. */
export function stripPlusTag(e: string): string {
  const m = normEmail(e).match(/^([^+@]+)(\+[^@]*)?@(.+)$/);
  return m ? `${m[1]}@${m[3]}` : normEmail(e);
}

export function parseAddresses(text: string): Participant[] {
  const out: Participant[] = [];
  for (const m of text.matchAll(ADDR_RE)) {
    const name = m[1]?.replace(/^[\s*_>]+|[\s*_]+$/g, "").replace(/^(fwd?|re)\s*:\s*/i, "").trim() || null;
    out.push({ name: name && name.length < 80 ? name : null, email: normEmail(m[2]) });
  }
  return out;
}

/**
 * Everyone the email involves: header recipients/sender plus the From/To/Cc
 * lines of any forwarded block in the body. Owner addresses, the CRM address
 * and auto-senders are dropped; duplicates are merged (a named occurrence
 * wins over a bare address).
 */
export function participantsOf(email: InboxEmail, ownerEmails: string[]): Participant[] {
  const owners = new Set(ownerEmails.map(stripPlusTag));
  const found = new Map<string, Participant>();
  const add = (p: Participant) => {
    if (owners.has(stripPlusTag(p.email))) return;
    if (NOISE_RE.test(p.email)) return;
    const cur = found.get(p.email);
    if (!cur) found.set(p.email, p);
    else if (!cur.name && p.name) cur.name = p.name;
  };
  for (const p of parseAddresses([email.from, ...email.to, ...email.cc].join(", "))) add(p);
  for (const line of email.body.split(/\r?\n/)) {
    const m = line.match(FWD_HEADER_RE);
    if (!m) continue;
    for (const p of parseAddresses(m[2])) add(p);
  }
  return [...found.values()];
}

/** #intake / #log anywhere in the subject (case-insensitive) forces the route. */
export function subjectTag(subject: string): "log" | "intake" | null {
  if (/(^|\s)#intake\b/i.test(subject)) return "intake";
  if (/(^|\s)#log\b/i.test(subject)) return "log";
  return null;
}

/** Strip the routing tag and Fwd:/Re: prefixes for display. */
export function cleanSubject(subject: string): string {
  return subject
    .replace(/(^|\s)#(intake|log)\b/gi, " ")
    .replace(/^\s*((fwd?|re|fw)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Roster people this email is about: matched by address first, then by full
 * name appearing in the text (two or more words, so a lone first name never
 * matches). Returns them in roster order.
 */
export function matchRoster(email: InboxEmail, participants: Participant[], roster: RosterEntry[]): { slug: string; name: string }[] {
  const byEmail = new Map<string, RosterEntry>();
  for (const r of roster) if (r.email) byEmail.set(normEmail(r.email), r);
  const hits = new Map<string, RosterEntry>();
  for (const p of participants) {
    const r = byEmail.get(p.email);
    if (r) hits.set(r.slug, r);
  }
  const text = `${email.subject}\n${email.from}\n${email.to.join(" ")}\n${email.cc.join(" ")}\n${email.body}`;
  for (const r of roster) {
    if (hits.has(r.slug)) continue;
    const words = r.name.trim().split(/\s+/);
    if (words.length < 2) continue;
    const re = new RegExp(`(^|[^A-Za-z])${escapeRe(r.name.trim()).replace(/\s+/g, "\\s+")}(?![A-Za-z])`, "i");
    if (re.test(text)) hits.set(r.slug, r);
  }
  return roster.filter((r) => hits.has(r.slug)).map((r) => ({ slug: r.slug, name: r.name }));
}

/**
 * Of the unknown participants, the one the email is really about: the sender
 * of the forwarded message if there is one (the first From: line in the
 * body), else the email's own sender, else the first unknown person.
 */
export function primaryParticipant(email: InboxEmail, unknown: Participant[]): Participant | null {
  if (!unknown.length) return null;
  const byEmail = new Map(unknown.map((p) => [p.email, p]));
  for (const line of email.body.split(/\r?\n/)) {
    const m = line.match(FWD_HEADER_RE);
    if (!m || m[1].toLowerCase() !== "from") continue;
    for (const p of parseAddresses(m[2])) {
      const hit = byEmail.get(p.email);
      if (hit) return hit;
    }
    break; // only the outermost forwarded message counts
  }
  for (const p of parseAddresses(email.from)) {
    const hit = byEmail.get(p.email);
    if (hit) return hit;
  }
  return unknown[0];
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * `force` is a re-route chosen by hand on the queue: it beats a #log / #intake
 * tag in the subject.
 */
export function routeEmail(email: InboxEmail, roster: RosterEntry[], ownerEmails: string[], force: "log" | "intake" | null = null): Route {
  const participants = participantsOf(email, ownerEmails);
  const known = matchRoster(email, participants, roster);
  const knownEmails = new Set(roster.filter((r) => known.some((k) => k.slug === r.slug) && r.email).map((r) => normEmail(r.email!)));
  // Someone matched by name (no email on file, or an older one) is known, not new.
  const knownNames = new Set(known.map((k) => normName(k.name)));
  const unknown = participants.filter((p) => !knownEmails.has(p.email) && !(p.name && knownNames.has(normName(p.name))));
  const forced = force ?? subjectTag(email.subject);

  let mode: Route["mode"];
  if (forced === "intake") mode = "intake";
  else if (forced === "log") mode = "log";
  else if (known.length && unknown.length) mode = "both";
  else if (unknown.length) mode = "intake";
  // Nobody recognisable at all (headers stripped by a phone client, say):
  // let the Log model try — it matches roster names in the content itself,
  // and its "nobody matched" error shows on the queue with a re-route button.
  else mode = "log";
  return { mode, known, unknown, forced };
}

/**
 * The text the Log model gets: metadata header lines (the same shape the
 * Zoom/Meet/Gmail retrieval step produces) followed by the message.
 */
export function logInputFor(email: InboxEmail, date: string | null): string {
  return [
    `TITLE: ${cleanSubject(email.subject) || "(no subject)"}`,
    `DATE: ${date ?? "unknown"}`,
    `PARTICIPANTS: ${[email.from, ...email.to, ...email.cc].filter(Boolean).join("; ")}`,
    `SOURCE: email forwarded to the CRM address`,
    `CONTENT:`,
    email.body.trim(),
  ].join("\n");
}

/**
 * The text an Intake draft gets for one unknown participant: who the draft
 * is for, then the whole email for context (the other people in it are
 * context, not the subject of the intake).
 */
export function intakeInputFor(email: InboxEmail, who: Participant, date: string | null, ownerEmails: string[] = []): string {
  const others = participantsOf(email, [...ownerEmails, who.email]).filter((p) => p.email !== who.email);
  return [
    `THIS INTAKE IS FOR: ${who.name ? `${who.name} <${who.email}>` : who.email}`,
    others.length ? `Others on the email (context only, not the person to add): ${others.map((o) => (o.name ? `${o.name} <${o.email}>` : o.email)).join("; ")}` : "",
    `Email subject: ${cleanSubject(email.subject) || "(no subject)"}${date ? ` · date: ${date}` : ""}`,
    `From: ${email.from}`,
    "",
    email.body.trim(),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Every address that belongs to the owner, plus-tags included. */
export function ownerAddresses(ownerEmail: string | null | undefined, inboxAddress: string, extra: string[] = []): string[] {
  return [ownerEmail ?? "", inboxAddress, ...extra].map((e) => e.trim()).filter(Boolean);
}

/**
 * True when the email's own sender (its From header — not a forwarded block
 * in the body) is one of the owner's addresses, plus-tags ignored. Mail-in
 * only acts on email the owner sent: anyone can write to a plus-address like
 * you+crm@gmail.com, and an email's body is passed to the model.
 */
export function sentByOwner(email: Pick<InboxEmail, "from">, ownerEmails: string[]): boolean {
  const owners = new Set(ownerEmails.map((e) => e.trim()).filter(Boolean).map(stripPlusTag));
  const sender = senderAddress(email.from);
  return !!sender && owners.has(stripPlusTag(sender));
}

/**
 * The one sender address in a From value, read strictly: `Name <addr>` with
 * no address in the name, or a lone bare address. Anything else (two
 * addresses, an address dressed up as the display name, as in
 * `"owner@x.com, y" <attacker@z>`) is null, so it can't pass as the owner.
 */
export function senderAddress(from: string): string | null {
  const s = String(from ?? "").trim();
  const angled = s.match(/^([^<>]*)<\s*([^\s<>@,;()"]+@[^\s<>@,;()"]+\.[A-Za-z]{2,})\s*>$/);
  if (angled) return /@/.test(angled[1]) ? null : normEmail(angled[2]);
  if (/^[^\s<>@,;()"]+@[^\s<>@,;()"]+\.[A-Za-z]{2,}$/.test(s)) return normEmail(s);
  return null;
}

// ---------------------------------------------------------------------------
// When to check the mailbox
// ---------------------------------------------------------------------------

/** After the owner's last click, how long they still count as using the app. */
export const INBOX_ACTIVE_WINDOW_MINUTES = 30;
/** The slowest cadence, while nobody is using the app. Mail waits safely: each check looks back two days. */
export const INBOX_AWAY_POLL_MINUTES = 240;

/**
 * Every check is a Claude run, and drafts wait for the owner to review them
 * anyway, so check at the owner's chosen pace only while they're using the
 * app. The clock runs from the last attempt, not the last success: a check
 * that keeps failing (an expired login, say) must not retry every minute.
 */
export function inboxCheckDue({
  now,
  lastAttemptAt,
  lastActiveAt,
  pollMinutes,
  followUpAt = null,
}: {
  now: number;
  lastAttemptAt: string | null;
  lastActiveAt: string | null;
  pollMinutes: number;
  /** A follow-up a full check asked for: due from then, whatever the pace. */
  followUpAt?: string | null;
}): boolean {
  const followUp = Date.parse(followUpAt ?? "");
  if (Number.isFinite(followUp) && now >= followUp) return true;
  const attempted = Date.parse(lastAttemptAt ?? "");
  if (!Number.isFinite(attempted)) return true;
  const active = Date.parse(lastActiveAt ?? "");
  const inUse = Number.isFinite(active) && now - active <= INBOX_ACTIVE_WINDOW_MINUTES * 60_000;
  const minutes = inUse ? pollMinutes : Math.max(pollMinutes, INBOX_AWAY_POLL_MINUTES);
  return now - attempted >= minutes * 60_000 - 5_000;
}
