import { getDb, STAGES } from "./db";
import { DEAL_COLD_DAYS, EFFECTIVE_BUCKET, allOpportunities, dealQuietDays, followUps } from "./queries";
import { openInboxItems } from "./inbox";
import { todayLocal } from "./dates.mjs";
import { getSetting, setSetting } from "./settings";
import { newsEnabled } from "./news";
import { urgentFindingCount } from "./agentActivity";

/**
 * Sidebar badges. Each entry is keyed by nav href. `tone` picks the colour:
 * "alert" (red, needs you now), "warn" (amber), "muted" (grey, just a size).
 * A missing key or n = 0 means no badge. Every count is of something that
 * needs the owner (an overdue to-do, a draft to review), never a plain size.
 * `dot`: also lights the phone menu's red dot (overdue to-dos and failed drafts only).
 */
export type NavTone = "alert" | "warn" | "muted";
export type NavBadge = { n: number; tone: NavTone; title: string; dot?: boolean };
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
  const put = (href: string, count: number, tone: NavTone, title: string, dot = false) => {
    if (count > 0) out[href] = { n: count, tone, title, ...(dot ? { dot } : {}) };
  };
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* a missing table/column on an old DB must never break the sidebar */
    }
  };

  // Inbox: emails with a draft ready to review or failed, or waiting to be read,
  // opened or not. Their drafts are counted here only, so one email doesn't light
  // Log and Intake too.
  safe(() => {
    const items = openInboxItems();
    const failed = items.filter((m) => m.state === "error").length;
    const ready = items.filter((m) => m.state === "ready").length;
    const held = items.filter((m) => m.state === "held").length;
    const title = failed || held ? `${ready} to review${held ? `, ${held} not read yet` : ""}${failed ? `, ${failed} failed` : ""}` : "Emails with a draft to review";
    put("/inbox", ready + failed + held, "alert", title, failed > 0);
  });

  const FROM_EMAIL_LOG = `id IN (SELECT log_draft_id FROM inbox_messages WHERE log_draft_id IS NOT NULL)`;
  const FROM_EMAIL_INTAKE = `id IN (SELECT j.value FROM inbox_messages m, json_each(COALESCE(NULLIF(m.intake_draft_ids,''),'[]')) j)`;
  safe(() => {
    const ready = n(`SELECT COUNT(*) n FROM intake_drafts WHERE status='ready' AND NOT ${FROM_EMAIL_INTAKE}`);
    const failed = n(`SELECT COUNT(*) n FROM intake_drafts WHERE status='error' AND NOT ${FROM_EMAIL_INTAKE}`);
    put("/intake", ready + failed, failed ? "alert" : "muted", failed ? `${ready} to review, ${failed} failed` : "Intake drafts to review", failed > 0);
  });

  safe(() => {
    const ready = n(`SELECT COUNT(*) n FROM log_drafts WHERE status='ready' AND NOT ${FROM_EMAIL_LOG}`);
    const failed = n(`SELECT COUNT(*) n FROM log_drafts WHERE status='error' AND NOT ${FROM_EMAIL_LOG}`);
    put("/log", ready + failed, failed ? "alert" : "muted", failed ? `${ready} to review, ${failed} failed` : "Log drafts to review", failed > 0);
  });

  // Actions: overdue to-dos only. The open count is on the page.
  safe(() => {
    const overdue = n(`SELECT COUNT(*) n FROM action_items a WHERE a.status='open' AND ${EFFECTIVE_BUCKET} = 'overdue'`);
    put("/actions", overdue, "alert", `${overdue} overdue`, true);
  });

  safe(() => {
    const due = followUps().filter((r) => r.days_over != null && r.days_over > 0).length;
    put("/followups", due, "warn", "People past their follow-up cadence");
  });

  // Pipeline: only deals that are slipping (quiet over a month, or no next step).
  safe(() => {
    const today = todayLocal();
    const slipping = allOpportunities().filter((o) => {
      if (!STAGES[o.stage]?.open) return false;
      const q = dealQuietDays(o, today);
      return !o.next_step || q == null || q > DEAL_COLD_DAYS;
    }).length;
    put("/pipeline", slipping, "warn", "Deals that need attention: quiet a month, or no next step");
  });

  safe(() => put("/outreach", n(`SELECT COUNT(*) n FROM outreach WHERE status='draft'`), "muted", "Unsent outreach drafts"));

  safe(() => put("/news", newsUnseen(), "muted", "New since you last looked"));

  safe(() => put("/coach", n(`SELECT COUNT(*) n FROM coach_proposals WHERE status='pending'`), "warn", "Coach proposals to review"));

  safe(() => put("/app-tests", urgentFindingCount(), "warn", "Open findings at the top two severities"));

  return out;
}
