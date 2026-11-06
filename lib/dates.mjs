/**
 * Date helpers shared by the app, the MCP server and the schema migrations.
 * All dates are local-time ISO strings (YYYY-MM-DD); nothing here uses UTC.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Today's local date as YYYY-MM-DD. */
export function todayLocal(d = new Date()) {
  return d.toLocaleDateString("sv-SE");
}

export function isIsoDate(s) {
  return typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(s));
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
