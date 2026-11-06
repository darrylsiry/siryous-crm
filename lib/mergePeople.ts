import type Database from "better-sqlite3";

/**
 * Merge a duplicate person profile into the one you want to keep (the logic
 * behind scripts/merge-people.ts).
 *
 * Everything attached to the duplicate (interactions, action items, outreach,
 * opportunities, briefs, connections) is re-pointed at the kept profile, and so
 * are its News Feed refs ("p:<slug>" in news_items.about) and Coach proposals
 * (coach_proposals.person_slug). Scalar fields on the kept profile win unless
 * empty; tags are unioned; status, status note, next action and last touch come
 * from whichever profile was touched more recently. Narrative sections from the
 * duplicate are appended to the kept profile under a "merged from" marker so
 * nothing is lost. The duplicate row is then deleted. Runs in one transaction;
 * with dryRun the receipt is built and everything is rolled back.
 */

export type Person = Record<string, string | number | null> & { id: number; slug: string; name: string };
export type MergeResult = { dup: Person; keep: Person; receipt: string[]; dryRun: boolean };

/** A merge that can't start (unknown or identical slugs); nothing was changed. */
export class MergeError extends Error {}

const SCALARS = ["email", "phone", "linkedin", "location", "role_title", "relationship_strength", "company_id", "company_note", "cadence_days"] as const;
const SECTIONS = ["relationship_intel", "business_context", "engagement_strategy", "extra_sections", "notes"] as const;
const REFS: [table: string, col: string][] = [
  ["interactions", "person_id"],
  ["action_items", "person_id"],
  ["outreach", "person_id"],
  ["opportunities", "person_id"],
  ["briefs", "person_id"],
  ["connections", "from_person_id"],
  ["connections", "to_person_id"],
];
const DRY_RUN = "__dry_run__";

/** First ISO date in a free-text last_touch, for "which profile is newer" comparisons. */
const touchDate = (s: string | number | null) => (typeof s === "string" && s.match(/\d{4}-\d{2}-\d{2}/)?.[0]) || "";

/** Distinct non-empty labels (case-insensitive, first spelling kept), joined; null when there are none. */
function combineLabels(labels: (string | null)[]): string | null {
  const seen = new Map<string, string>();
  for (const l of labels) {
    const t = (l ?? "").trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return seen.size ? [...seen.values()].join("; ") : null;
}

/** news_items.about as a list of refs; null when it isn't a JSON array (left untouched). */
function parseAbout(json: string): string[] | null {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function mergePeople(db: Database.Database, dupSlug: string, keepSlug: string, opts: { dryRun?: boolean } = {}): MergeResult {
  if (dupSlug === keepSlug) throw new MergeError(`Can't merge '${dupSlug}' into itself.`);
  const getPerson = (slug: string) => db.prepare(`SELECT * FROM people WHERE slug=?`).get(slug) as Person | undefined;
  const dup = getPerson(dupSlug);
  const keep = getPerson(keepSlug);
  if (!dup) throw new MergeError(`No person with slug '${dupSlug}'.`);
  if (!keep) throw new MergeError(`No person with slug '${keepSlug}'.`);

  const dupIsNewer = touchDate(dup.last_touch) > touchDate(keep.last_touch);
  const receipt: string[] = [];
  const merge = db.transaction(() => {
    for (const [table, col] of REFS) {
      const n = db.prepare(`UPDATE ${table} SET ${col}=? WHERE ${col}=?`).run(keep.id, dup.id).changes;
      if (n) receipt.push(`${table}.${col}: moved ${n}`);
    }
    // Only the kept person's connections can have changed: a link between the
    // two profiles is now a self-link, and a contact both knew is now a pair
    // twice. Keep the oldest row of each pair and every label it had.
    const selfLinks = db.prepare(`DELETE FROM connections WHERE from_person_id=? AND to_person_id=?`).run(keep.id, keep.id).changes;
    if (selfLinks) receipt.push(`connections: dropped ${selfLinks} self-link(s)`);
    const conns = db
      .prepare(`SELECT id, from_person_id, to_person_id, label FROM connections WHERE from_person_id=? OR to_person_id=? ORDER BY id`)
      .all(keep.id, keep.id) as { id: number; from_person_id: number; to_person_id: number; label: string | null }[];
    const pairs = new Map<string, typeof conns>();
    for (const c of conns) {
      const key = `${c.from_person_id}>${c.to_person_id}`;
      pairs.set(key, [...(pairs.get(key) ?? []), c]);
    }
    let dupPairs = 0;
    let relabelled = 0;
    for (const [first, ...rest] of pairs.values()) {
      if (!rest.length) continue;
      const label = combineLabels([first, ...rest].map((c) => c.label));
      if (label !== null && label !== first.label) {
        db.prepare(`UPDATE connections SET label=? WHERE id=?`).run(label, first.id);
        relabelled++;
      }
      for (const c of rest) db.prepare(`DELETE FROM connections WHERE id=?`).run(c.id);
      dupPairs += rest.length;
    }
    if (dupPairs) receipt.push(`connections: dropped ${dupPairs} duplicate pair(s)`);
    if (relabelled) receipt.push(`connections: combined labels on ${relabelled} pair(s)`);

    // News Feed refs and Coach proposals name the person by slug, not id.
    const dupRef = `p:${dup.slug}`;
    const keepRef = `p:${keep.slug}`;
    const news = db
      .prepare(`SELECT id, about FROM news_items WHERE instr(about, ?) > 0`)
      .all(JSON.stringify(dupRef)) as { id: number; about: string }[];
    let newsMoved = 0;
    for (const item of news) {
      const refs = parseAbout(item.about);
      if (!refs?.includes(dupRef)) continue;
      const about = [...new Set(refs.map((r) => (r === dupRef ? keepRef : r)))];
      db.prepare(`UPDATE news_items SET about=? WHERE id=?`).run(JSON.stringify(about), item.id);
      newsMoved++;
    }
    if (newsMoved) receipt.push(`news_items.about: moved ${newsMoved}`);
    const proposals = db.prepare(`UPDATE coach_proposals SET person_slug=? WHERE person_slug=?`).run(keep.slug, dup.slug).changes;
    if (proposals) receipt.push(`coach_proposals.person_slug: moved ${proposals}`);

    const updates: Record<string, string | number | null> = {};
    for (const f of SCALARS) {
      if ((keep[f] === null || keep[f] === "") && dup[f] !== null && dup[f] !== "") updates[f] = dup[f];
    }
    const tags = new Set(
      [keep.tags, dup.tags]
        .flatMap((t) => String(t ?? "").split(","))
        .map((t) => t.trim())
        .filter(Boolean)
    );
    if (tags.size) updates.tags = [...tags].join(",");
    // The later imported "connected on" date stays the floor for last touch (see recomputeLastTouch in lib/actions.ts).
    const floor = [keep.connected_on, dup.connected_on].filter((d): d is string => typeof d === "string" && !!touchDate(d)).sort().at(-1);
    if (floor && floor !== keep.connected_on) updates.connected_on = floor;
    if (dupIsNewer) {
      for (const f of ["status_key", "status_note", "next_action", "last_touch"] as const) {
        if (dup[f] !== null && dup[f] !== "") updates[f] = dup[f];
      }
    }
    for (const s of SECTIONS) {
      const extra = dup[s];
      if (typeof extra !== "string" || !extra.trim()) continue;
      const marker = `\n\n---\n_Merged from duplicate profile \`${dup.slug}\` (created ${dup.created_at}):_\n\n`;
      updates[s] = keep[s] ? `${keep[s]}${marker}${extra}` : extra;
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      db.prepare(`UPDATE people SET ${keys.map((k) => `${k}=@${k}`).join(", ")}, updated_at=datetime('now') WHERE id=@id`).run({ ...updates, id: keep.id });
      receipt.push(`people[${keep.slug}]: updated ${keys.join(", ")}`);
    }
    db.prepare(`DELETE FROM people WHERE id=?`).run(dup.id);
    receipt.push(`people[${dup.slug}] (id ${dup.id}): deleted`);
    if (opts.dryRun) throw new Error(DRY_RUN);
  });

  try {
    merge();
  } catch (err) {
    if (!(err instanceof Error && err.message === DRY_RUN)) throw err;
    return { dup, keep, receipt, dryRun: true };
  }
  return { dup, keep, receipt, dryRun: false };
}
