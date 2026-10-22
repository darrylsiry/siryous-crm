import { getDb, STAGES } from "./db";
import { EFFECTIVE_BUCKET, followUps } from "./queries";
import { getSetting, setSetting } from "./settings";
import { newsEnabled } from "./news";

/**
 * Sidebar badges. Each entry is keyed by nav href. `tone` picks the colour:
 * "alert" (red, needs you now), "warn" (amber), "muted" (grey, just a size).
 * A missing key or n = 0 means no badge.
 */
export type NavTone = "alert" | "warn" | "muted";
export type NavBadge = { n: number; tone: NavTone; title: string };
export type NavCounts = Record<string, NavBadge>;

const RESOLVED = `('confirmed','discarded')`;

/**
 * Unread inbox email, as a WHERE condition on alias m: not opened, not
 * ignored, and not already dealt with through its drafts (an email whose every
 * draft was confirmed or discarded counts as read even if never opened).
 */
export const INBOX_UNREAD_COND = `
  m.read_at IS NULL AND m.status <> 'ignored'
  AND NOT (
    (m.log_draft_id IS NOT NULL OR json_array_length(COALESCE(NULLIF(m.intake_draft_ids,''),'[]')) > 0)
    AND COALESCE((SELECT status FROM log_drafts WHERE id = m.log_draft_id), 'confirmed') IN ${RESOLVED}
    AND NOT EXISTS (
      SELECT 1 FROM json_each(COALESCE(NULLIF(m.intake_draft_ids,''),'[]')) j
      JOIN intake_drafts d ON d.id = j.value
      WHERE d.status NOT IN ${RESOLVED}
    )
  )`;

const n = (sql: string): number => (getDb().prepare(sql).get() as { n: number }).n;

/** News Feed: undismissed items found since the page was last opened. */
function newsUnseen(): number {
  if (!newsEnabled()) return 0;
  const seen = getSetting("news.last_seen_at");
  if (!seen) {
    // First run: start the clock now rather than flagging the whole backlog.
    markNewsSeen();
    return 0;
  }
  return (
    getDb()
      .prepare(`SELECT COUNT(*) n FROM news_items WHERE dismissed_at IS NULL AND found_at > ?`)
      .get(seen) as { n: number }
  ).n;
}

/** Called when the News Feed page renders. found_at uses SQLite's datetime('now') format, so this does too. */
export function markNewsSeen() {
  const now = (getDb().prepare(`SELECT datetime('now') t`).get() as { t: string }).t;
  setSetting("news.last_seen_at", now);
}

export function navCounts(): NavCounts {
  const out: NavCounts = {};
  const put = (href: string, count: number, tone: NavTone, title: string) => {
    if (count > 0) out[href] = { n: count, tone, title };
  };
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* a missing table/column on an old DB must never break the sidebar */
    }
  };

  safe(() => put("/inbox", n(`SELECT COUNT(*) n FROM inbox_messages m WHERE ${INBOX_UNREAD_COND}`), "alert", "Unread emails"));

  safe(() => put("/intake", n(`SELECT COUNT(*) n FROM intake_drafts WHERE status='ready'`), "muted", "Intake drafts waiting for review"));

  safe(() => {
    const ready = n(`SELECT COUNT(*) n FROM log_drafts WHERE status='ready'`);
    const failed = n(`SELECT COUNT(*) n FROM log_drafts WHERE status='error'`);
    put(
      "/log",
      ready + failed,
      failed > 0 ? "alert" : "muted",
      failed > 0 ? `${ready} waiting for review, ${failed} failed` : "Log drafts waiting for review"
    );
  });

  safe(() => {
    const open = n(`SELECT COUNT(*) n FROM action_items WHERE status='open'`);
    const overdue = n(`SELECT COUNT(*) n FROM action_items a WHERE a.status='open' AND ${EFFECTIVE_BUCKET} = 'overdue'`);
    put("/actions", open, overdue > 0 ? "alert" : "muted", overdue > 0 ? `${open} open, ${overdue} overdue` : `${open} open`);
  });

  safe(() => {
    const due = followUps().filter((r) => r.days_over != null && r.days_over > 0).length;
    put("/followups", due, "warn", "People past their follow-up cadence");
  });

  safe(() => {
    const openStages = Object.entries(STAGES)
      .filter(([, s]) => s.open)
      .map(([k]) => k);
    const active = openStages.length
      ? (
          getDb()
            .prepare(`SELECT COUNT(*) n FROM opportunities WHERE stage IN (${openStages.map(() => "?").join(",")})`)
            .get(...openStages) as { n: number }
        ).n
      : 0;
    put("/pipeline", active, "muted", "Active opportunities");
  });

  safe(() => put("/outreach", n(`SELECT COUNT(*) n FROM outreach WHERE status='draft'`), "muted", "Unsent outreach drafts"));

  safe(() => put("/news", newsUnseen(), "alert", "New since you last looked"));

  safe(() => put("/coach", n(`SELECT COUNT(*) n FROM coach_proposals WHERE status='pending'`), "warn", "Coach proposals to review"));

  return out;
}
