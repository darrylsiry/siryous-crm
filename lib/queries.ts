import { getDb, STAGES, VOCAB } from "./db";
import { keepWarmSql, statusRankSql } from "./vocab.mjs";
import { COMPANY_SEARCH_COLUMNS, PEOPLE_SEARCH_COLUMNS, daysOver, daysSinceTouchSql, effectiveBucketSql, likeAnySql, likeNeedle } from "./rules.mjs";
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


export function allPeople(): (PersonWithCompany & Versioned & { connected_on: string | null; logged: number })[] {
  return getDb()
    .prepare(
      `SELECT p.*, c.name AS company_name, c.slug AS company_slug,
              EXISTS (SELECT 1 FROM interactions i WHERE i.person_id = p.id) AS logged
       FROM people p LEFT JOIN companies c ON c.id = p.company_id
       ORDER BY ${statusRankSql(VOCAB, "p.status_key")}, p.name`
    )
    .all() as (PersonWithCompany & Versioned & { connected_on: string | null; logged: number })[];
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

export function allCompanies(): (Company & Versioned & { people_count: number; key_people: string })[] {
  return getDb()
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM people p WHERE p.company_id = c.id) AS people_count,
        COALESCE((SELECT GROUP_CONCAT(p.name, ' · ') FROM people p WHERE p.company_id = c.id), '') AS key_people
       FROM companies c
       ORDER BY ${statusRankSql(VOCAB, "c.status_key")}, c.name`
    )
    .all() as (Company & Versioned & { people_count: number; key_people: string })[];
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

/** People this person is connected to (either direction), for the profile's side column. */
export function connectionsFor(personId: number): { slug: string; name: string; label: string | null }[] {
  return getDb()
    .prepare(
      `SELECT p.slug, p.name, c.label FROM connections c JOIN people p ON p.id = c.to_person_id WHERE c.from_person_id = ?
       UNION
       SELECT p.slug, p.name, c.label FROM connections c JOIN people p ON p.id = c.from_person_id WHERE c.to_person_id = ?
       ORDER BY 2`
    )
    .all(personId, personId) as { slug: string; name: string; label: string | null }[];
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
export const EFFECTIVE_BUCKET = effectiveBucketSql("a");

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

/** Done to-dos, newest first; `days` keeps only those completed in that many days. */
export function doneActionItems({ days }: { days?: number } = {}): ActionItemJoined[] {
  const recent = days ? `AND a.completed_at >= date('now','localtime','-${Math.floor(days)} days')` : "";
  return getDb()
    .prepare(
      `SELECT a.*, p.name AS person_name, p.slug AS person_slug,
              c.name AS company_name, c.slug AS company_slug
       FROM action_items a
       LEFT JOIN people p ON p.id = a.person_id
       LEFT JOIN companies c ON c.id = a.company_id
       WHERE a.status = 'done' ${recent}
       ORDER BY a.completed_at DESC, a.id DESC`
    )
    .all() as ActionItemJoined[];
}

/** How many to-dos are done in all (for "Show older"). */
export function doneActionCount(): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM action_items WHERE status='done'`).get() as { n: number }).n;
}

/** People and companies as picker options, sent once per page (components/PeoplePicker.tsx). */
export function peopleOptions(): { value: string; label: string; hint: string | null }[] {
  return (
    getDb()
      .prepare(`SELECT p.id, p.name, c.name AS company FROM people p LEFT JOIN companies c ON c.id = p.company_id ORDER BY p.name`)
      .all() as { id: number; name: string; company: string | null }[]
  ).map((p) => ({ value: String(p.id), label: p.name, hint: p.company }));
}
export function companyOptions(): { value: string; label: string }[] {
  return (getDb().prepare(`SELECT id, name FROM companies ORDER BY name`).all() as { id: number; name: string }[]).map((c) => ({
    value: String(c.id),
    label: c.name,
  }));
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

/** Deals: days since the last logged contact before a deal reads "quiet" (amber) and "gone quiet" (red, needs attention). */
export const DEAL_QUIET_DAYS = 14;
export const DEAL_COLD_DAYS = 30;

/** Days since the last dated interaction with a deal's person or company; null when there is none. */
export function dealQuietDays(o: { person_id: number | null; company_id: number | null }, today: string): number | null {
  const d = (
    getDb()
      .prepare(
        `SELECT MAX(date) AS d FROM interactions
         WHERE ((person_id IS NOT NULL AND person_id = ?) OR (company_id IS NOT NULL AND company_id = ?)) AND date GLOB '[0-9][0-9][0-9][0-9]-*'`
      )
      .get(o.person_id ?? -1, o.company_id ?? -1) as { d: string | null }
  ).d;
  if (!d) return null;
  return Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${d.slice(0, 10)}T12:00:00`).getTime()) / 86_400_000);
}

/** The words and colour for a deal's quiet days, the same on the Dashboard and the board. */
export function dealQuietLabel(days: number | null): { text: string; tone: string } {
  if (days == null) return { text: "no contact logged", tone: "text-red-700" };
  // (A deal with nobody linked shows "nobody linked" instead: see the card and the Dashboard.)
  const text = days === 0 ? "talked today" : `${days}d since contact`;
  return { text, tone: days > DEAL_COLD_DAYS ? "text-red-700" : days > DEAL_QUIET_DAYS ? "text-amber-700" : "text-stone-500" };
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
              ${daysSinceTouchSql("p")} AS days_since
       FROM people p LEFT JOIN companies c ON c.id = p.company_id
       WHERE ${keepWarmSql(VOCAB, "p.status_key")}`
    )
    .all() as (Omit<FollowUp, "days_over"> & { days_since: number | null })[];
  return rows
    .map((r) => ({ ...r, days_over: daysOver(r.cadence_days, r.days_since) }))
    .sort((a, b) => (b.days_over ?? -9999) - (a.days_over ?? -9999));
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


export function search(q: string): SearchResults {
  const db = getDb();
  const like = likeNeedle(q);
  // Fetch one past the limit so the caller can tell "exactly 20" from "more than 20".
  const n = SEARCH_LIMIT + 1;
  const people = db
    .prepare(
      `SELECT p.*, c.name AS company_name, c.slug AS company_slug
       FROM people p LEFT JOIN companies c ON c.id = p.company_id
       WHERE ${likeAnySql(PEOPLE_SEARCH_COLUMNS, "@q", "p")} OR c.name LIKE @q ESCAPE '\\'
       ORDER BY p.name LIMIT @n`
    )
    .all({ q: like, n }) as PersonWithCompany[];
  const companies = db
    .prepare(
      `SELECT * FROM companies
       WHERE ${likeAnySql(COMPANY_SEARCH_COLUMNS, "@q")}
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
