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

/**
 * Best-effort: turn a free-text due label ("07-30", "Fri 7/25", "~07-22",
 * "by 2026-06-27", "Aug 31") into an ISO date. Month/day without a year take
 * the year of `base` (default today), rolling forward if that would land more
 * than 45 days in the past. Returns null for vague labels ("ASAP", "late summer").
 */
export function parseDueDate(label, base = todayLocal()) {
  if (!label) return null;
  const s = String(label).trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return ymd(+iso[1], +iso[2], +iso[3]);
  const baseDate = isIsoDate(base) ? new Date(base + "T00:00:00") : new Date();
  let m = s.match(/(?:^|[^\d])(\d{1,2})[\/-](\d{1,2})(?:[^\d]|$)/);
  let month, day;
  if (m) {
    month = +m[1];
    day = +m[2];
  } else {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const named = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i)
      ?? s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
    if (!named) return null;
    const [a, b] = /^\d/.test(named[1]) ? [named[2], named[1]] : [named[1], named[2]];
    month = months.indexOf(a.slice(0, 3).toLowerCase()) + 1;
    day = +b;
  }
  if (!month || !day || month > 12 || day > 31) return null;
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
