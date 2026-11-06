/**
 * Date helpers shared by the app, the MCP server and the schema migrations.
 * All dates are local-time ISO strings (YYYY-MM-DD); nothing here uses UTC.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Today's local date as YYYY-MM-DD. */
export function todayLocal(d = new Date()) {
  return d.toLocaleDateString("sv-SE");
}

/** A real calendar date written YYYY-MM-DD: "2026-02-30" and "2026-13-01" are not (Date.parse accepts the first). */
export function isIsoDate(s) {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return ymd(y, m, d) === s;
}

/**
 * The one short date format for screens: "Mar 12" in the current year,
 * "Mar 12, 2024" otherwise, so an old date can't pass for a recent one.
 * Takes anything starting YYYY-MM-DD; "" for anything else.
 */
export function shortDate(iso, today = todayLocal()) {
  const s = String(iso ?? "").slice(0, 10);
  if (!isIsoDate(s)) return "";
  const opts = { month: "short", day: "numeric" };
  if (s.slice(0, 4) !== String(today).slice(0, 4)) opts.year = "numeric";
  return new Date(`${s}T12:00:00`).toLocaleDateString("en-US", opts);
}

/**
 * A timestamp SQLite stored with datetime('now'), which is UTC
 * ("2026-11-03 22:04:05"), shown in local time: "Nov 3, 5:04 PM" (with the
 * year when it isn't this year). An ISO string with a zone is read as is.
 */
export function localStamp(stored, today = todayLocal()) {
  const raw = String(stored ?? "").trim();
  if (!raw) return "";
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return raw;
  const local = todayLocal(d);
  return `${shortDate(local, today)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** "just now", "5 min ago", "2h ago", "yesterday", "3 days ago", then a date: how long ago a stored UTC timestamp was. */
export function ago(stored, now = new Date()) {
  const raw = String(stored ?? "").trim();
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  const days = Math.round(mins / 1440);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return shortDate(todayLocal(d), todayLocal(now));
}

/** The local calendar date of a stored UTC timestamp (a brief written at 9pm is dated today, not tomorrow). */
export function localDateOf(stored) {
  const raw = String(stored ?? "").trim();
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? raw.slice(0, 10) : todayLocal(d);
}

function ymd(y, m, d) {
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; // e.g. 02-30
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// m/d with an optional /yy or /yyyy (same separator). The lookarounds keep it off
// decimals ("1.5-2"), times ("10-11:30") and tokens such as "Q3-4".
const NUMERIC = /(?<![\w.]|\d:)(\d{1,2})([\/-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![.:]?\d)/g;
// A unit after the numbers makes it a duration or time range: "1-2 weeks", "2-3 days", "1-2pm".
const UNIT_AFTER = /^\s*(?:(?:more|extra|business|working|calendar)\s+)?(?:d|days?|w|wks?|weeks?|mos?|months?|h|hrs?|hours?|mins?|minutes?|yrs?|years?|qtrs?|quarters?|[ap]\.?m\.?)(?![a-z])/i;

/**
 * Best-effort: turn a free-text due label ("07-30", "Fri 7/25", "~07-22",
 * "by 2026-06-27", "Aug 31", "12/31/2025") into an ISO date. A written year is
 * used as is; month/day without one take the year of `base` (default today),
 * rolling forward if that would land more than 45 days in the past. Returns null
 * for vague labels ("ASAP", "late summer") and for ranges ("in 1-2 weeks", "2-3 days").
 */
export function parseDueDate(label, base = todayLocal()) {
  if (!label) return null;
  const s = String(label).trim();
  const iso = s.match(/(?<!\d)(\d{4})([-\/])(\d{1,2})\2(\d{1,2})(?!\d)/);
  if (iso) return ymd(+iso[1], +iso[3], +iso[4]);
  const baseDate = isIsoDate(base) ? new Date(base + "T00:00:00") : new Date();
  let month, day, written;
  for (const m of s.matchAll(NUMERIC)) {
    if (!m[4] && UNIT_AFTER.test(s.slice(m.index + m[0].length))) continue;
    if (m[2] === "-" && /\b(?:in|within)\s+~?$/i.test(s.slice(0, m.index))) continue;
    month = +m[1];
    day = +m[3];
    if (m[4]) written = m[4].length === 2 ? 2000 + +m[4] : +m[4];
    break;
  }
  if (month === undefined) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const named = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b(?:,?\s+(20\d{2})\b)?/i)
      ?? s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b\.?(?:,?\s+(20\d{2})\b)?/i);
    if (!named) return null;
    const [a, b] = /^\d/.test(named[1]) ? [named[2], named[1]] : [named[1], named[2]];
    month = months.indexOf(a.slice(0, 3).toLowerCase()) + 1;
    day = +b;
    if (named[3]) written = +named[3];
  }
  if (!month || !day || month > 12 || day > 31) return null;
  if (written) return ymd(written, month, day);
  let year = baseDate.getFullYear();
  let out = ymd(year, month, day);
  if (!out) return null;
  const diffDays = (new Date(out + "T00:00:00") - baseDate) / 86400000;
  if (diffDays < -45) out = ymd(year + 1, month, day);
  return out;
}

/**
 * Split a legacy last_touch value into a date and a note:
 *   "2026-06-23 (phone catch-up)" → { date: "2026-06-23", note: "phone catch-up" }
 *   "recent call"                  → { date: null, note: "recent call" }
 *   "2026-07-15"                   → { date: "2026-07-15", note: null }
 */
export function splitLastTouch(value) {
  if (value == null) return { date: null, note: null };
  const s = String(value).trim();
  if (!s) return { date: null, note: null };
  const m = s.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
  if (m && isIsoDate(m[1])) {
    const note = m[2].replace(/^[\s(\-—:]+|[\s)]+$/g, "").trim();
    return { date: m[1], note: note || null };
  }
  return { date: null, note: s };
}
