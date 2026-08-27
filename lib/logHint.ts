import type Database from "better-sqlite3";
import type { LogAnalysis, LogHint } from "./ai";

/** Entry targets are people slugs, or "company:<slug>" to log on a company with no specific person. */
export const COMPANY_TARGET = "company:";

/**
 * Resolve the profile the Log page was opened from (if any) into what the
 * prompt needs. Unknown ids are ignored rather than failing the draft.
 */
export function loadLogHint(db: Database.Database, personId: number | null, companyId: number | null): LogHint | null {
  if (personId) {
    const p = db
      .prepare(`SELECT p.slug, p.name, c.name AS company FROM people p LEFT JOIN companies c ON c.id = p.company_id WHERE p.id=?`)
      .get(personId) as { slug: string; name: string; company: string | null } | undefined;
    if (p) return { kind: "person", slug: p.slug, name: p.name, company: p.company, members: [] };
  }
  if (companyId) {
    const c = db.prepare(`SELECT slug, name FROM companies WHERE id=?`).get(companyId) as { slug: string; name: string } | undefined;
    if (c) {
      const members = db.prepare(`SELECT slug, name FROM people WHERE company_id=? ORDER BY name`).all(companyId) as { slug: string; name: string }[];
      return { kind: "company", slug: c.slug, name: c.name, company: null, members };
    }
  }
  return null;
}

/**
 * When the model found nobody to log against but the draft was opened from a
 * profile, log on that profile rather than failing — a quick note rarely
 * names the person you're already looking at.
 */
export function applyLogHintFallback(analysis: LogAnalysis, hint: LogHint | null, content: string): LogAnalysis {
  if (analysis.entries.length || !hint) return analysis;
  const summary_md = analysis.summary_md?.trim() || content.trim();
  return {
    ...analysis,
    entries: [
      {
        person_slug: hint.kind === "person" ? hint.slug : `${COMPANY_TARGET}${hint.slug}`,
        summary_md,
        next_action: null,
      },
    ],
    confidence_flags: [
      ...analysis.confidence_flags,
      `Nobody in the text matched your roster, so this is logged on ${hint.name} because you opened Log from their profile.`,
    ],
  };
}
