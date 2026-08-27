/**
 * CRM vocabulary: pipeline statuses, action buckets, opportunity stages and
 * kinds, relationship strengths and default keep-warm cadences. The defaults
 * below are merged with an optional gitignored config/vocab.json (copy
 * config/vocab.example.json to start) so a user can rename labels, change
 * emoji or colours, add entries or drop ones they never use — without editing
 * code. Plain JS so both the Next.js app and the MCP server import the same
 * thing; every prompt list and zod enum is generated from it, so the copies
 * can't drift. Read once per process (per config file).
 *
 * Override the file location with VOCAB_CONFIG=/path/to/vocab.json.
 *
 * Tailwind only emits classes it sees in source, so config entries name a
 * palette ("color": "emerald") and PALETTES below holds every class string
 * literally. Unknown palette names fall back to "stone".
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Palette name → class strings for each place a colour is used.
 * status/kind: pill badge classes. stage: top-border classes for a pipeline
 * column. Keep every string a literal in this file.
 */
export const PALETTES = {
  emerald: { badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", stage: "border-t-emerald-400" },
  sky: { badge: "bg-sky-50 text-sky-700 ring-sky-600/20", stage: "border-t-sky-400" },
  orange: { badge: "bg-orange-50 text-orange-700 ring-orange-600/20", stage: "border-t-orange-400" },
  slate: { badge: "bg-slate-100 text-slate-600 ring-slate-500/20", stage: "border-t-slate-400" },
  violet: { badge: "bg-violet-50 text-violet-700 ring-violet-600/20", stage: "border-t-violet-400" },
  green: { badge: "bg-green-50 text-green-700 ring-green-600/20", stage: "border-t-green-400" },
  red: { badge: "bg-red-50 text-red-700 ring-red-600/20", stage: "border-t-red-300" },
  zinc: { badge: "bg-zinc-100 text-zinc-500 ring-zinc-400/20", stage: "border-t-zinc-400" },
  amber: { badge: "bg-amber-50 text-amber-700 ring-amber-600/20", stage: "border-t-amber-400" },
  stone: { badge: "bg-stone-100 text-stone-600 ring-stone-500/20", stage: "border-t-stone-400" },
  indigo: { badge: "bg-indigo-50 text-indigo-700 ring-indigo-600/20", stage: "border-t-indigo-400" },
  fuchsia: { badge: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20", stage: "border-t-fuchsia-400" },
  teal: { badge: "bg-teal-50 text-teal-700 ring-teal-600/20", stage: "border-t-teal-400" },
  blue: { badge: "bg-blue-50 text-blue-700 ring-blue-600/20", stage: "border-t-blue-400" },
  rose: { badge: "bg-rose-50 text-rose-700 ring-rose-600/20", stage: "border-t-rose-400" },
  yellow: { badge: "bg-yellow-50 text-yellow-700 ring-yellow-600/20", stage: "border-t-yellow-400" },
};

export const DEFAULT_VOCAB = {
  status: {
    new: { emoji: "🌱", label: "New", color: "emerald" },
    exploring: { emoji: "🔍", label: "Exploring", color: "sky" },
    active: { emoji: "🔥", label: "Active", color: "orange" },
    on_hold: { emoji: "⏸️", label: "On hold", color: "slate" },
    client: { emoji: "🤝", label: "Client", color: "violet" },
    won: { emoji: "✅", label: "Won", color: "green" },
    lost: { emoji: "❌", label: "Lost", color: "red" },
    dormant: { emoji: "😴", label: "Dormant", color: "zinc" },
  },
  buckets: {
    overdue: { label: "Overdue — your move", icon: "🔴", order: 0 },
    log_gap: { label: "Log missing outcomes", icon: "🟠", order: 1 },
    this_week: { label: "Dated — this week & upcoming", icon: "🟡", order: 2 },
    awaiting: { label: "Awaiting the other party", icon: "⏳", order: 3 },
    high_potential: { label: "High-potential outreach", icon: "🎯", order: 4 },
    keep_warm: { label: "Keep-warm / longer horizon", icon: "🔵", order: 5 },
    venture: { label: "Venture threads", icon: "💡", order: 6 },
    data_gap: { label: "Open data gaps", icon: "📋", order: 7 },
  },
  stages: {
    identified: { label: "Identified", icon: "💡", color: "stone", order: 0, open: true },
    discussing: { label: "In conversation", icon: "💬", color: "sky", order: 1, open: true },
    scoping: { label: "Scoping / proposal", icon: "📐", color: "amber", order: 2, open: true },
    negotiating: { label: "Negotiating terms", icon: "🤝", color: "orange", order: 3, open: true },
    engaged: { label: "Engaged — active", icon: "🔥", color: "green", order: 4, open: true },
    won: { label: "Won / closed", icon: "✅", color: "green", order: 5, open: false },
    lost: { label: "Lost / passed", icon: "❌", color: "red", order: 6, open: false },
    on_hold: { label: "On hold", icon: "⏸️", color: "stone", order: 7, open: false },
  },
  kinds: {
    engagement: { label: "Engagement", color: "indigo" },
    partnership: { label: "Partnership", color: "violet" },
    venture: { label: "Venture", color: "fuchsia" },
    referral: { label: "Referral", color: "teal" },
  },
  strengths: ["Cold", "Acquaintance", "Warm", "Trusted"],
  /** Default keep-warm cadence (days) by status; null or missing = no cadence. */
  cadence: { active: 30, client: 14, exploring: 45, new: 21, on_hold: 60, won: 90, dormant: 180, lost: null },
};

const FALLBACK_PALETTE = "stone";

/** Resolve a palette name to its class strings; unknown names fall back to stone. */
export function palette(name) {
  const n = typeof name === "string" ? name.trim() : "";
  return PALETTES[n] ?? PALETTES[FALLBACK_PALETTE];
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Merge one keyed group: file entries replace/extend defaults; `remove` drops keys.
 * @param {Record<string, object>} defaults
 * @param {unknown} fromFile
 * @param {string[]} remove
 */
function mergeGroup(defaults, fromFile, remove) {
  const out = {};
  for (const [k, v] of Object.entries(defaults)) out[k] = { ...v };
  if (isObj(fromFile)) {
    for (const [k, v] of Object.entries(fromFile)) {
      if (k === "remove") continue;
      if (!isObj(v)) continue;
      out[k] = { ...(out[k] ?? {}), ...v };
    }
  }
  for (const k of remove) delete out[k];
  return out;
}

/** @param {unknown} v */
function removeList(v) {
  return isObj(v) && Array.isArray(v.remove) ? v.remove.map(String) : [];
}

/** Sort a group by `order` (ties keep insertion order) so a bucket/stage added with order 2.5 lands where expected. */
function sortByOrder(group) {
  const entries = Object.entries(group);
  entries.sort((a, b) => (a[1].order ?? Number.MAX_SAFE_INTEGER) - (b[1].order ?? Number.MAX_SAFE_INTEGER));
  return Object.fromEntries(entries);
}

/** @param {Record<string, object>} group */
function withNumericOrder(group) {
  let i = 0;
  for (const v of Object.values(group)) {
    if (typeof v.order !== "number" || !Number.isFinite(v.order)) v.order = i;
    i++;
  }
  return group;
}

/** @param {object} raw merged, palette names still unresolved */
function finish(raw) {
  const status = {};
  for (const [k, v] of Object.entries(sortByOrder(withNumericOrder(raw.status)))) {
    status[k] = { emoji: String(v.emoji ?? ""), label: String(v.label ?? k), color: palette(v.color).badge };
  }
  const buckets = {};
  for (const [k, v] of Object.entries(sortByOrder(withNumericOrder(raw.buckets)))) {
    buckets[k] = { label: String(v.label ?? k), icon: String(v.icon ?? ""), order: v.order };
  }
  const stages = {};
  for (const [k, v] of Object.entries(sortByOrder(withNumericOrder(raw.stages)))) {
    stages[k] = {
      label: String(v.label ?? k),
      icon: String(v.icon ?? ""),
      color: palette(v.color).stage,
      order: v.order,
      open: v.open !== false,
    };
  }
  const kinds = {};
  for (const [k, v] of Object.entries(sortByOrder(withNumericOrder(raw.kinds)))) {
    kinds[k] = { label: String(v.label ?? k), badge: palette(v.color).badge };
  }
  const strengths = Object.freeze(raw.strengths.map(String));
  /** Every status gets an entry: a number of days, or null. */
  const cadence = {};
  for (const k of Object.keys(status)) {
    const d = raw.cadence[k];
    cadence[k] = typeof d === "number" && Number.isFinite(d) && d > 0 ? Math.round(d) : null;
  }
  return { status, buckets, stages, kinds, strengths, cadence };
}

/** @param {object} fromFile parsed config/vocab.json (or {}) */
export function mergeVocab(fromFile) {
  const f = isObj(fromFile) ? fromFile : {};
  const raw = {
    status: mergeGroup(DEFAULT_VOCAB.status, f.status, removeList(f.status)),
    buckets: mergeGroup(DEFAULT_VOCAB.buckets, f.buckets, removeList(f.buckets)),
    stages: mergeGroup(DEFAULT_VOCAB.stages, f.stages, removeList(f.stages)),
    kinds: mergeGroup(DEFAULT_VOCAB.kinds, f.kinds, removeList(f.kinds)),
    strengths: Array.isArray(f.strengths) && f.strengths.length ? f.strengths : DEFAULT_VOCAB.strengths,
    cadence: { ...DEFAULT_VOCAB.cadence },
  };
  if (isObj(f.cadence)) {
    for (const [k, v] of Object.entries(f.cadence)) {
      if (k === "remove") continue;
      raw.cadence[k] = v;
    }
    for (const k of removeList(f.cadence)) raw.cadence[k] = null;
  }
  return finish(raw);
}

const cache = new Map();

/**
 * @param {string} [root] project root (defaults to cwd)
 * @returns {ReturnType<typeof mergeVocab> & { configPath: string; configured: boolean }}
 */
export function loadVocab(root = process.cwd()) {
  const file = process.env.VOCAB_CONFIG || path.join(root, "config", "vocab.json");
  const hit = cache.get(file);
  if (hit) return hit;
  let fromFile = null;
  try {
    fromFile = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* no config yet — defaults */
  }
  const v = mergeVocab(fromFile ?? {});
  v.configPath = file;
  v.configured = fromFile !== null;
  cache.set(file, v);
  return v;
}

/**
 * Prompt helpers — the single wording every model prompt and MCP tool
 * description uses, so a bucket added in config shows up everywhere. Pass the
 * vocab the caller already loaded (lib/db.ts's VOCAB, the MCP server's) so the
 * prompt and the UI are guaranteed to describe the same thing.
 */
export function statusList(v) {
  return Object.keys(v.status).join(", ");
}
export function bucketList(v) {
  return Object.keys(v.buckets).join(", ");
}
export function stageList(v) {
  return Object.keys(v.stages).join(", ");
}
export function kindList(v) {
  return Object.keys(v.kinds).join(", ");
}
/** "cadence_days by status: new 21, exploring 45, active 30, …; lost none" */
export function cadenceSentence(v) {
  const withDays = Object.entries(v.cadence).filter(([, d]) => d != null);
  const without = Object.entries(v.cadence).filter(([, d]) => d == null).map(([k]) => k);
  const parts = withDays.map(([k, d]) => `${k} ${d}`);
  return `cadence_days by status: ${parts.join(", ")}${without.length ? `; ${without.join(", ")} none` : ""}`;
}
