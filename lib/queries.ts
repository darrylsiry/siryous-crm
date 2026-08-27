import { getDb, STAGES } from "./db";
import type {
  ActionItemJoined,
  Company,
  FollowUp,
  Interaction,
  OpportunityJoined,
  Outreach,
  Person,
  PersonWithCompany,
} from "./types";

const STATUS_ORDER = `CASE status_key
  WHEN 'active' THEN 0 WHEN 'client' THEN 1 WHEN 'exploring' THEN 2 WHEN 'new' THEN 3
  WHEN 'on_hold' THEN 4 WHEN 'won' THEN 5 WHEN 'dormant' THEN 6 WHEN 'lost' THEN 7 ELSE 8 END`;

export function allPeople(): PersonWithCompany[] {
  return getDb()
    .prepare(
      `SELECT p.*, c.name AS company_name, c.slug AS company_slug
       FROM people p LEFT JOIN companies c ON c.id = p.company_id
       ORDER BY ${STATUS_ORDER.replaceAll("status_key", "p.status_key")}, p.name`
    )
    .all() as PersonWithCompany[];
}

/** Row version carried by the profile edit forms for optimistic concurrency. */
export type Versioned = { updated_at: string | null };

export function personBySlug(slug: string): (PersonWithCompany & Versioned) | undefined {
  return getDb()
    .prepare(
      `SELECT p.*, c.name AS company_name, c.slug AS company_slug
       FROM people p LEFT JOIN companies c ON c.id = p.company_id WHERE p.slug = ?`
    )
    .get(slug) as (PersonWithCompany & Versioned) | undefined;
}

export function allCompanies(): (Company & { people_count: number; key_people: string })[] {
  return getDb()
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM people p WHERE p.company_id = c.id) AS people_count,
        COALESCE((SELECT GROUP_CONCAT(p.name, ' · ') FROM people p WHERE p.company_id = c.id), '') AS key_people
       FROM companies c
       ORDER BY ${STATUS_ORDER.replaceAll("status_key", "c.status_key")}, c.name`
    )
    .all() as (Company & { people_count: number; key_people: string })[];
}

export function companyBySlug(slug: string): (Company & Versioned) | undefined {
  return getDb().prepare(`SELECT * FROM companies WHERE slug = ?`).get(slug) as
    | (Company & Versioned)
    | undefined;
}

export function peopleAtCompany(companyId: number): Person[] {
  return getDb()
    .prepare(`SELECT * FROM people WHERE company_id = ? ORDER BY name`)
    .all(companyId) as Person[];
}

export function interactionsFor(opts: { personId?: number; companyId?: number }): Interaction[] {
  const db = getDb();
  if (opts.personId) {
    return db
      .prepare(`SELECT * FROM interactions WHERE person_id = ? ORDER BY date DESC, id DESC`)
      .all(opts.personId) as Interaction[];
  }
  // company view: interactions logged on the company OR on its people
  return db
    .prepare(
      `SELECT i.*, p.name AS person_name, p.slug AS person_slug FROM interactions i
       LEFT JOIN people p ON p.id = i.person_id
       WHERE i.company_id = ? OR i.person_id IN (SELECT id FROM people WHERE company_id = ?)
       ORDER BY i.date DESC, i.id DESC`
    )
    .all(opts.companyId, opts.companyId) as Interaction[];
}

/** SQL for the effective bucket: anything with a passed due date is overdue, whatever it was filed under. */
export const EFFECTIVE_BUCKET = `CASE WHEN a.status='open' AND a.due_date IS NOT NULL AND a.due_date < date('now','localtime') THEN 'overdue' ELSE a.bucket END`;

export function openActionItems(): ActionItemJoined[] {
  return getDb()
    .prepare(
      `SELECT a.*, a.bucket AS bucket_raw, ${EFFECTIVE_BUCKET} AS bucket,
              p.name AS person_name, p.slug AS person_slug,
              c.name AS company_name, c.slug AS company_slug
       FROM action_items a
       LEFT JOIN people p ON p.id = a.person_id
       LEFT JOIN companies c ON c.id = a.company_id
       WHERE a.status = 'open'
       ORDER BY a.due_date IS NULL, a.due_date, a.id`
    )
    .all() as ActionItemJoined[];
}

export function doneActionItems(): ActionItemJoined[] {
  return getDb()
    .prepare(
      `SELECT a.*, p.name AS person_name, p.slug AS person_slug,
              c.name AS company_name, c.slug AS company_slug
       FROM action_items a
       LEFT JOIN people p ON p.id = a.person_id
       LEFT JOIN companies c ON c.id = a.company_id
       WHERE a.status = 'done'
       ORDER BY a.completed_at DESC, a.id DESC`
    )
    .all() as ActionItemJoined[];
}

export function allOutreach(): (Outreach & { person_name: string | null; person_slug: string | null })[] {
  return getDb()
    .prepare(
      `SELECT o.*, p.name AS person_name, p.slug AS person_slug
       FROM outreach o LEFT JOIN people p ON p.id = o.person_id
       ORDER BY o.date DESC, o.id DESC`
    )
    .all() as (Outreach & { person_name: string | null; person_slug: string | null })[];
}

export function outreachById(id: number): (Outreach & { person_name: string | null; person_slug: string | null }) | undefined {
  return getDb()
    .prepare(
      `SELECT o.*, p.name AS person_name, p.slug AS person_slug
       FROM outreach o LEFT JOIN people p ON p.id = o.person_id WHERE o.id = ?`
    )
    .get(id) as (Outreach & { person_name: string | null; person_slug: string | null }) | undefined;
}

export function dashboardStats() {
  const db = getDb();
  const people = db.prepare(`SELECT status_key, COUNT(*) n FROM people GROUP BY status_key`).all() as { status_key: string; n: number }[];
  const companies = db.prepare(`SELECT status_key, COUNT(*) n FROM companies GROUP BY status_key`).all() as { status_key: string; n: number }[];
  const openActions = (db.prepare(`SELECT COUNT(*) n FROM action_items WHERE status='open'`).get() as { n: number }).n;
  const overdue = (
    db.prepare(`SELECT COUNT(*) n FROM action_items a WHERE a.status='open' AND ${EFFECTIVE_BUCKET} = 'overdue'`).get() as { n: number }
  ).n;
  return { people, companies, openActions, overdue };
}

export function allOpportunities(): OpportunityJoined[] {
  return getDb()
    .prepare(
      `SELECT o.*, p.name AS person_name, p.slug AS person_slug,
              c.name AS company_name, c.slug AS company_slug
       FROM opportunities o
       LEFT JOIN people p ON p.id = o.person_id
       LEFT JOIN companies c ON c.id = o.company_id
       ORDER BY o.priority, o.updated_at DESC`
    )
    .all() as OpportunityJoined[];
}

/** Deep link to an opportunity's card on the pipeline board (closed/on-hold cards live in a collapsed section). */
export function opportunityHref(o: { id: number; stage: string }): string {
  const open = STAGES[o.stage]?.open ?? true;
  return `/pipeline${open ? "" : "?show=closed"}#opp-${o.id}`;
}

export function opportunitiesFor(opts: { personId?: number; companyId?: number }): OpportunityJoined[] {
  const where = opts.personId ? "o.person_id = ?" : "o.company_id = ?";
  return getDb()
    .prepare(
      `SELECT o.*, p.name AS person_name, p.slug AS person_slug,
              c.name AS company_name, c.slug AS company_slug
       FROM opportunities o
       LEFT JOIN people p ON p.id = o.person_id
       LEFT JOIN companies c ON c.id = o.company_id
       WHERE ${where} ORDER BY o.priority, o.updated_at DESC`
    )
    .all(opts.personId ?? opts.companyId) as OpportunityJoined[];
}

/** Everyone with a cadence, scored by how overdue a touch is. */
export function followUps(): FollowUp[] {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.slug, p.name, p.status_key, p.status_note, p.relationship_strength,
              p.tags, p.last_touch, p.last_touch_note, p.next_action, p.cadence_days,
              c.name AS company_name, c.slug AS company_slug,
              CAST(julianday('now','localtime') - julianday(substr(p.last_touch, 1, 10)) AS INTEGER) AS days_since
       FROM people p LEFT JOIN companies c ON c.id = p.company_id
       WHERE p.status_key NOT IN ('lost')`
    )
    .all() as (Omit<FollowUp, "days_over"> & { days_since: number | null })[];
  return rows
    .map((r) => ({
      ...r,
      days_over:
        r.cadence_days == null
          ? null
          : r.days_since == null
            ? 9999 // never touched but has a cadence → surface it
            : r.days_since - r.cadence_days,
    }))
    .sort((a, b) => (b.days_over ?? -9999) - (a.days_over ?? -9999));
}

export function dueForTouch(limit = 6): FollowUp[] {
  return followUps()
    .filter((f) => f.days_over !== null && f.days_over > 0)
    .slice(0, limit);
}

export interface MapData {
  people: { id: number; slug: string; name: string; status_key: string; company_id: number | null }[];
  companies: { id: number; slug: string; name: string; status_key: string }[];
  connections: { from_person_id: number; to_person_id: number; label: string | null }[];
}

export function mapData(): MapData {
  const db = getDb();
  return {
    people: db
      .prepare(`SELECT id, slug, name, status_key, company_id FROM people`)
      .all() as MapData["people"],
    companies: db
      .prepare(`SELECT id, slug, name, status_key FROM companies`)
      .all() as MapData["companies"],
    connections: db
      .prepare(`SELECT from_person_id, to_person_id, label FROM connections`)
      .all() as MapData["connections"],
  };
}

export const SEARCH_LIMIT = 20;

export interface SearchResults {
  people: PersonWithCompany[];
  companies: Company[];
  interactions: (Interaction & { person_name: string | null; person_slug: string | null; company_name: string | null; company_slug: string | null })[];
  actions: ActionItemJoined[];
  opportunities: OpportunityJoined[];
  /** Sections that hit SEARCH_LIMIT and were cut off. */
  truncated: { [K in keyof Omit<SearchResults, "truncated">]: boolean };
}

/** Escape LIKE metacharacters so a literal %, _ or \ in the query matches itself. */
function likeNeedle(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export function search(q: string): SearchResults {
  const db = getDb();
  const like = likeNeedle(q);
  // Fetch one past the limit so the caller can tell "exactly 20" from "more than 20".
  const n = SEARCH_LIMIT + 1;
  const people = db
    .prepare(
      `SELECT p.*, c.name AS company_name, c.slug AS company_slug
       FROM people p LEFT JOIN companies c ON c.id = p.company_id
       WHERE p.name LIKE @q ESCAPE '\\' OR p.role_title LIKE @q ESCAPE '\\' OR p.tags LIKE @q ESCAPE '\\'
         OR p.notes LIKE @q ESCAPE '\\' OR p.relationship_intel LIKE @q ESCAPE '\\'
         OR p.business_context LIKE @q ESCAPE '\\' OR p.engagement_strategy LIKE @q ESCAPE '\\'
       ORDER BY p.name LIMIT @n`
    )
    .all({ q: like, n }) as PersonWithCompany[];
  const companies = db
    .prepare(
      `SELECT * FROM companies
       WHERE name LIKE @q ESCAPE '\\' OR industry LIKE @q ESCAPE '\\' OR notes LIKE @q ESCAPE '\\'
         OR business_context LIKE @q ESCAPE '\\'
       ORDER BY name LIMIT @n`
    )
    .all({ q: like, n }) as Company[];
  const interactions = db
    .prepare(
      `SELECT i.*, p.name AS person_name, p.slug AS person_slug,
              c.name AS company_name, c.slug AS company_slug
       FROM interactions i
       LEFT JOIN people p ON p.id = i.person_id
       LEFT JOIN companies c ON c.id = i.company_id
       WHERE i.summary LIKE @q ESCAPE '\\' ORDER BY i.date DESC LIMIT @n`
    )
    .all({ q: like, n }) as SearchResults["interactions"];
  const actions = db
    .prepare(
      `SELECT a.*, p.name AS person_name, p.slug AS person_slug,
              c.name AS company_name, c.slug AS company_slug
       FROM action_items a
       LEFT JOIN people p ON p.id = a.person_id
       LEFT JOIN companies c ON c.id = a.company_id
       WHERE a.detail LIKE @q ESCAPE '\\' OR a.title LIKE @q ESCAPE '\\' ORDER BY a.status, a.id LIMIT @n`
    )
    .all({ q: like, n }) as ActionItemJoined[];
  const opportunities = db
    .prepare(
      `SELECT o.*, p.name AS person_name, p.slug AS person_slug,
              c.name AS company_name, c.slug AS company_slug
       FROM opportunities o
       LEFT JOIN people p ON p.id = o.person_id
       LEFT JOIN companies c ON c.id = o.company_id
       WHERE o.name LIKE @q ESCAPE '\\' OR o.value_note LIKE @q ESCAPE '\\'
         OR o.next_step LIKE @q ESCAPE '\\' OR o.notes LIKE @q ESCAPE '\\'
       ORDER BY o.priority, o.updated_at DESC LIMIT @n`
    )
    .all({ q: like, n }) as OpportunityJoined[];
  const cut = <T,>(rows: T[]) => rows.slice(0, SEARCH_LIMIT);
  return {
    people: cut(people),
    companies: cut(companies),
    interactions: cut(interactions),
    actions: cut(actions),
    opportunities: cut(opportunities),
    truncated: {
      people: people.length > SEARCH_LIMIT,
      companies: companies.length > SEARCH_LIMIT,
      interactions: interactions.length > SEARCH_LIMIT,
      actions: actions.length > SEARCH_LIMIT,
      opportunities: opportunities.length > SEARCH_LIMIT,
    },
  };
}

export function recentInteractions(limit = 10) {
  return getDb()
    .prepare(
      `SELECT i.*, p.name AS person_name, p.slug AS person_slug,
              c.name AS company_name, c.slug AS company_slug
       FROM interactions i
       LEFT JOIN people p ON p.id = i.person_id
       LEFT JOIN companies c ON c.id = i.company_id
       WHERE i.date GLOB '[0-9][0-9][0-9][0-9]-*'
       ORDER BY i.date DESC, i.id DESC LIMIT ?`
    )
    .all(limit) as (Interaction & {
    person_name: string | null;
    person_slug: string | null;
    company_name: string | null;
    company_slug: string | null;
  })[];
}
