import type Database from "better-sqlite3";
import { getDb } from "./db";
import { claudeBin, extractJsonWithRepair, runClaudeStream, TOOLS } from "./ai";
import { loadOwner } from "./owner.mjs";
import { getSetting, setSetting } from "./settings";
import {
  buildNewsPrompt,
  chunk,
  cleanItems,
  headlineKey,
  NEWS_BATCH_SIZE,
  sinceFor,
  urlKey,
  type NewsItemIn,
  type NewsSubject,
} from "./newsCore";

/**
 * News Feed: once a day, Claude (web search only — no connectors, so a web
 * page can't steer it into anyone's mail or calendar) looks for news about
 * every person and company in the roster, a batch at a time. Items are kept
 * until dismissed; a dismissed URL is remembered so it never comes back.
 *
 * Settings: news.enabled ("on" / "off"; off until the owner turns it on, except
 * on installs that already ran it before it became opt-in),
 * news.last_run_at, news.last_error, news.progress (while a scan runs).
 */

/** A subject is due once its last check is this old (a little under a day, so the daily run doesn't drift later). */
const DUE_AFTER_MS = 22 * 3_600_000;
/** Stop a scan after this many failed batches in a row (expired login, no network…). */
const MAX_FAILS_IN_A_ROW = 2;

export interface NewsSettings {
  enabled: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  progress: string | null;
}

/**
 * The daily run sends every contact's name, role and employer to Claude, so it
 * is opt-in. Installs that already ran it while it was on by default (a
 * last-run stamp and no explicit choice) keep running.
 */
export function newsEnabled(): boolean {
  const v = getSetting("news.enabled");
  if (v === "on") return true;
  if (v === "off") return false;
  return getSetting("news.last_run_at") !== null;
}

export function getNewsSettings(): NewsSettings {
  return {
    enabled: newsEnabled(),
    lastRunAt: getSetting("news.last_run_at"),
    lastError: getSetting("news.last_error"),
    progress: getSetting("news.progress"),
  };
}

function joinContext(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ")
    .slice(0, 260);
}

/** Every roster person and company, with when each was last searched. */
export function newsSubjects(db: Database.Database = getDb()): NewsSubject[] {
  const checks = new Map(
    (db.prepare(`SELECT kind, subject_id, checked_at FROM news_checks`).all() as { kind: string; subject_id: number; checked_at: string }[]).map(
      (r) => [`${r.kind}:${r.subject_id}`, r.checked_at]
    )
  );
  const people = db
    .prepare(
      `SELECT p.id, p.slug, p.name, p.role_title, p.location, COALESCE(c.name, p.company_note) AS company
       FROM people p LEFT JOIN companies c ON c.id = p.company_id ORDER BY p.name`
    )
    .all() as { id: number; slug: string; name: string; role_title: string | null; location: string | null; company: string | null }[];
  const companies = db
    .prepare(`SELECT id, slug, name, industry, hq, website FROM companies ORDER BY name`)
    .all() as { id: number; slug: string; name: string; industry: string | null; hq: string | null; website: string | null }[];
  // Contacts at each company, so a story about a big organisation can be tied to someone you know there.
  const contactsAt = new Map<number, string[]>();
  for (const r of db.prepare(`SELECT company_id, name FROM people WHERE company_id IS NOT NULL ORDER BY name`).all() as {
    company_id: number;
    name: string;
  }[]) {
    const list = contactsAt.get(r.company_id) ?? [];
    if (list.length < 3) list.push(r.name);
    contactsAt.set(r.company_id, list);
  }
  return [
    ...companies.map((c) => ({
      ref: `c:${c.slug}`,
      kind: "company" as const,
      id: c.id,
      name: c.name,
      context: joinContext([
        c.industry,
        c.hq,
        c.website?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, ""),
        contactsAt.has(c.id) ? `contacts: ${contactsAt.get(c.id)!.join(" / ")}` : null,
      ]),
      checkedAt: checks.get(`c:${c.id}`) ?? null,
    })),
    ...people.map((p) => ({
      ref: `p:${p.slug}`,
      kind: "person" as const,
      id: p.id,
      name: p.name,
      context: joinContext([p.role_title && p.company ? `${p.role_title} at ${p.company}` : (p.role_title ?? p.company), p.location]),
      checkedAt: checks.get(`p:${p.id}`) ?? null,
    })),
  ];
}

export function dueSubjects(all: NewsSubject[], now = Date.now()): NewsSubject[] {
  return all.filter((s) => !s.checkedAt || now - new Date(s.checkedAt).getTime() >= DUE_AFTER_MS);
}

/** Insert new stories; a story already stored (same URL, or same headline) just gains the extra subjects. Returns how many were new. */
export function storeNewsItems(db: Database.Database, items: NewsItemIn[]): number {
  const byUrl = db.prepare(`SELECT id, about FROM news_items WHERE url_key=?`);
  const byHeadline = db.prepare(`SELECT id, about FROM news_items WHERE headline_key=? ORDER BY id DESC LIMIT 1`);
  const setAbout = db.prepare(`UPDATE news_items SET about=? WHERE id=?`);
  const insert = db.prepare(
    `INSERT INTO news_items (url, url_key, headline, headline_key, source, summary, published, about) VALUES (?,?,?,?,?,?,?,?)`
  );
  let added = 0;
  db.transaction(() => {
    for (const it of items) {
      const hk = headlineKey(it.headline);
      const existing = (byUrl.get(urlKey(it.url)) ?? (hk.length >= 20 ? byHeadline.get(hk) : undefined)) as
        | { id: number; about: string }
        | undefined;
      if (existing) {
        const about = new Set<string>(parseRefs(existing.about));
        const before = about.size;
        for (const r of it.about) about.add(r);
        if (about.size !== before) setAbout.run(JSON.stringify([...about]), existing.id);
        continue;
      }
      insert.run(it.url, urlKey(it.url), it.headline, hk, it.source, it.summary, it.published, JSON.stringify(it.about));
      added++;
    }
  })();
  return added;
}

export function parseRefs(json: string | null): string[] {
  try {
    const v = json ? JSON.parse(json) : [];
    return Array.isArray(v) ? v.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

function markChecked(db: Database.Database, batch: NewsSubject[], at: string): void {
  const up = db.prepare(
    `INSERT INTO news_checks (kind, subject_id, checked_at) VALUES (?,?,?)
     ON CONFLICT(kind, subject_id) DO UPDATE SET checked_at=excluded.checked_at`
  );
  db.transaction(() => {
    for (const s of batch) up.run(s.kind === "person" ? "p" : "c", s.id, at);
  })();
}

// ---------------------------------------------------------------------------
// A scan
// ---------------------------------------------------------------------------

export interface ScanResult {
  searched: number;
  added: number;
  error: string | null;
}

let scanning: Promise<ScanResult> | null = null;

export function newsScanRunning(): boolean {
  return scanning !== null;
}

/**
 * Search for news about the subjects that are due (all of them when `force`).
 * Concurrent callers share the running scan.
 */
export function runNewsScan(force = false): Promise<ScanResult> {
  if (scanning) return scanning;
  scanning = scanInner(force).finally(() => {
    scanning = null;
    setSetting("news.progress", null);
  });
  return scanning;
}

async function scanInner(force: boolean): Promise<ScanResult> {
  const db = getDb();
  const result: ScanResult = { searched: 0, added: 0, error: null };
  if (!claudeBin()) {
    result.error = "The Claude tool isn't installed, so the web can't be searched (see “If you use Claude” in the README).";
    setSetting("news.last_error", result.error);
    return result;
  }
  const all = newsSubjects(db);
  const due = force ? all : dueSubjects(all);
  if (!due.length) return result;
  const batches = chunk(due, NEWS_BATCH_SIZE);
  const owner = loadOwner();
  let failsInARow = 0;
  let lastError: string | null = null;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    setSetting("news.progress", `Searching batch ${i + 1} of ${batches.length} (${due.length} people and companies)`);
    const now = new Date();
    const today = now.toLocaleDateString("sv-SE");
    const since = sinceFor(batch, now);
    try {
      const text = await runClaudeStream(buildNewsPrompt(batch, since, today, owner.possessive), {
        allowedTools: TOOLS.web,
        timeoutMs: 600_000,
      });
      const items = cleanItems(await extractJsonWithRepair(text), batch, since, today);
      result.added += storeNewsItems(db, items);
      markChecked(db, batch, now.toISOString());
      result.searched += batch.length;
      failsInARow = 0;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[news] batch ${i + 1}/${batches.length} failed: ${lastError}`);
      if (++failsInARow >= MAX_FAILS_IN_A_ROW) break;
    }
  }
  result.error = lastError;
  if (result.searched) setSetting("news.last_run_at", new Date().toISOString());
  setSetting("news.last_error", lastError);
  return result;
}

// ---------------------------------------------------------------------------
// Background loop (started from instrumentation.ts)
// ---------------------------------------------------------------------------

let loopTimer: NodeJS.Timeout | null = null;

/** Every 15 minutes: if News Feed is on and anyone is due, run a scan. */
export function startNewsLoop(): void {
  if (loopTimer) return;
  setSetting("news.progress", null); // a scan cut off by a restart
  const tick = async () => {
    try {
      if (!getNewsSettings().enabled || !claudeBin() || scanning) return;
      if (!dueSubjects(newsSubjects()).length) return;
      const r = await runNewsScan();
      console.log(`[news] searched ${r.searched}, ${r.added} new item(s)${r.error ? ` — ${r.error}` : ""}`);
    } catch (err) {
      console.error("[news] scan failed:", err);
    }
  };
  loopTimer = setInterval(tick, 15 * 60_000);
  loopTimer.unref();
  setTimeout(tick, 60_000).unref();
}

// ---------------------------------------------------------------------------
// Reading the feed
// ---------------------------------------------------------------------------

export interface NewsFeedItem {
  id: number;
  url: string;
  headline: string;
  source: string | null;
  summary: string | null;
  published: string | null;
  found_at: string;
  dismissed_at: string | null;
  about: { ref: string; name: string; href: string }[];
}

/** The feed, newest story first. `dismissed` shows the dismissed ones instead. */
export function newsFeed({ dismissed = false, limit = 300 }: { dismissed?: boolean; limit?: number } = {}): NewsFeedItem[] {
  const db = getDb();
  const names = new Map<string, { name: string; href: string }>();
  for (const r of db.prepare(`SELECT slug, name FROM people`).all() as { slug: string; name: string }[])
    names.set(`p:${r.slug}`, { name: r.name, href: `/people/${r.slug}` });
  for (const r of db.prepare(`SELECT slug, name FROM companies`).all() as { slug: string; name: string }[])
    names.set(`c:${r.slug}`, { name: r.name, href: `/companies/${r.slug}` });
  const rows = db
    .prepare(
      `SELECT * FROM news_items WHERE dismissed_at IS ${dismissed ? "NOT NULL" : "NULL"}
       ORDER BY COALESCE(published, substr(found_at,1,10)) DESC, id DESC LIMIT ?`
    )
    .all(limit) as (Omit<NewsFeedItem, "about"> & { about: string })[];
  return rows.map((r) => ({
    ...r,
    about: parseRefs(r.about)
      .map((ref) => (names.has(ref) ? { ref, ...names.get(ref)! } : null))
      .filter((x): x is { ref: string; name: string; href: string } => x !== null),
  }));
}

export function newsCounts(): { open: number; dismissed: number } {
  const r = getDb()
    .prepare(`SELECT SUM(dismissed_at IS NULL) AS open, SUM(dismissed_at IS NOT NULL) AS dismissed FROM news_items`)
    .get() as { open: number | null; dismissed: number | null };
  return { open: r.open ?? 0, dismissed: r.dismissed ?? 0 };
}
