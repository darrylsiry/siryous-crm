import Database from "better-sqlite3";
import path from "path";
import { openDatabase } from "./schema.mjs";

/** Override with CRM_DB_PATH; otherwise data/crm.db under the project root. */
export const DB_PATH = process.env.CRM_DB_PATH || path.join(process.cwd(), "data", "crm.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  // Assign only after the schema is in place so a failed migration is retried
  // on the next call instead of caching a half-initialised connection.
  const db = openDatabase(Database, DB_PATH) as Database.Database;
  _db = db;
  return db;
}

export const STATUS: Record<string, { emoji: string; label: string; color: string }> = {
  new: { emoji: "🌱", label: "New", color: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  exploring: { emoji: "🔍", label: "Exploring", color: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  active: { emoji: "🔥", label: "Active", color: "bg-orange-50 text-orange-700 ring-orange-600/20" },
  on_hold: { emoji: "⏸️", label: "On hold", color: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  client: { emoji: "🤝", label: "Client", color: "bg-violet-50 text-violet-700 ring-violet-600/20" },
  won: { emoji: "✅", label: "Won", color: "bg-green-50 text-green-700 ring-green-600/20" },
  lost: { emoji: "❌", label: "Lost", color: "bg-red-50 text-red-700 ring-red-600/20" },
  dormant: { emoji: "😴", label: "Dormant", color: "bg-zinc-100 text-zinc-500 ring-zinc-400/20" },
};

export const BUCKETS: Record<string, { label: string; icon: string; order: number }> = {
  overdue: { label: "Overdue — your move", icon: "🔴", order: 0 },
  log_gap: { label: "Log missing outcomes", icon: "🟠", order: 1 },
  this_week: { label: "Dated — this week & upcoming", icon: "🟡", order: 2 },
  awaiting: { label: "Awaiting the other party", icon: "⏳", order: 3 },
  high_potential: { label: "High-potential outreach", icon: "🎯", order: 4 },
  keep_warm: { label: "Keep-warm / longer horizon", icon: "🔵", order: 5 },
  venture: { label: "Venture threads", icon: "💡", order: 6 },
  data_gap: { label: "Open data gaps", icon: "📋", order: 7 },
};

export const STRENGTHS = ["Cold", "Acquaintance", "Warm", "Trusted"] as const;

export const STAGES: Record<string, { label: string; icon: string; color: string; order: number; open: boolean }> = {
  identified: { label: "Identified", icon: "💡", color: "border-t-stone-400", order: 0, open: true },
  discussing: { label: "In conversation", icon: "💬", color: "border-t-sky-400", order: 1, open: true },
  scoping: { label: "Scoping / proposal", icon: "📐", color: "border-t-amber-400", order: 2, open: true },
  negotiating: { label: "Negotiating terms", icon: "🤝", color: "border-t-orange-400", order: 3, open: true },
  engaged: { label: "Engaged — active", icon: "🔥", color: "border-t-green-500", order: 4, open: true },
  won: { label: "Won / closed", icon: "✅", color: "border-t-green-400", order: 5, open: false },
  lost: { label: "Lost / passed", icon: "❌", color: "border-t-red-300", order: 6, open: false },
  on_hold: { label: "On hold", icon: "⏸️", color: "border-t-stone-300", order: 7, open: false },
};

export const KINDS: Record<string, { label: string; badge: string }> = {
  engagement: { label: "Engagement", badge: "bg-indigo-50 text-indigo-700 ring-indigo-600/20" },
  partnership: { label: "Partnership", badge: "bg-violet-50 text-violet-700 ring-violet-600/20" },
  venture: { label: "Venture", badge: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20" },
  referral: { label: "Referral", badge: "bg-teal-50 text-teal-700 ring-teal-600/20" },
};

/** Default keep-warm cadence (days) by pipeline status; null = no cadence. */
export const DEFAULT_CADENCE: Record<string, number | null> = {
  active: 30,
  client: 14,
  exploring: 45,
  new: 21,
  on_hold: 60,
  won: 90,
  dormant: 180,
  lost: null,
};
