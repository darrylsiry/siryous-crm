/**
 * Shapes the models are asked to return, checked before anything is stored
 * as "ready". Ollama's JSON mode guarantees syntax, not shape: a local model
 * will happily omit an array, return null for a list, or write a lone string
 * where a list was expected. These schemas coerce the harmless cases (missing
 * list → [], "none" → ["none"], numeric strings → numbers, stray extra keys
 * dropped) and reject the rest with a readable message, so a review page can
 * never be handed data it can't render.
 */
import { z } from "zod";
import type { IntakeAnalysis, LogAnalysis, PrepResearch } from "./ai";
import type { CoachClose, CoachTurn } from "./coachai";

const asString = (v: unknown) => (v == null ? null : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null);

/** Nullable string; numbers/booleans are stringified, anything else becomes null. */
const nstr = z.preprocess(asString, z.string().nullable());
/** Required non-empty string. */
const rstr = z.preprocess((v) => asString(v)?.trim() ?? "", z.string().min(1));
/** String with a default of "" when missing. */
const dstr = z.preprocess((v) => asString(v) ?? "", z.string());
/** Nullable integer; numeric strings accepted. */
const nint = z.preprocess((v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}, z.number().int().nullable());

/** List of strings: null → [], lone string → [string], non-strings stringified, empties dropped. */
const strList = z.preprocess((v) => {
  const arr = v == null ? [] : Array.isArray(v) ? v : [v];
  return arr.map(asString).filter((s): s is string => !!s && s.trim().length > 0);
}, z.array(z.string()));

/** List of integers: tolerant of numeric strings and "#12" style ids. */
const intList = z.preprocess((v) => {
  const arr = v == null ? [] : Array.isArray(v) ? v : [v];
  return arr
    .map((x) => (typeof x === "number" ? x : Number(String(x ?? "").replace(/[^\d]/g, ""))))
    .filter((n) => Number.isInteger(n) && n > 0);
}, z.array(z.number().int()));

/** List of objects where a malformed item is dropped rather than failing the whole response. */
function listOf<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((v) => {
    if (!Array.isArray(v)) return [];
    return v.map((x) => item.safeParse(x)).filter((r) => r.success).map((r) => (r as { data: unknown }).data);
  }, z.array(item));
}

const nullableObject = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null), schema.nullable());

export const IntakeAnalysisSchema = z.object({
  person: z.object({
    name: rstr,
    role_title: nstr,
    location: nstr,
    linkedin: nstr,
    email: nstr,
    existing_person_slug: nstr,
    existing_company_slug: nstr,
    new_company: nullableObject(
      z.object({
        name: rstr,
        industry: nstr,
        website: nstr,
        hq: nstr,
        business_context_md: nstr,
      })
    ),
    status_suggestion: z.preprocess((v) => asString(v)?.trim().toLowerCase() || "new", z.string()),
    status_note: nstr,
    relationship_strength: nstr,
    tags: z.preprocess((v) => (Array.isArray(v) ? v.map(asString).filter(Boolean).join(", ") : asString(v)), z.string().nullable()),
    cadence_days: nint,
    next_action: nstr,
    relationship_intel_md: nstr,
    business_context_md: nstr,
    engagement_strategy_md: nstr,
    notes_md: nstr,
  }),
  connections: listOf(z.object({ person_slug: rstr, label: dstr, reason: dstr })),
  suggested_actions: listOf(z.object({ title: rstr, bucket: z.preprocess((v) => asString(v) ?? "this_week", z.string()), due: nstr })),
  interaction: nullableObject(z.object({ date: nstr, channel: nstr, summary_md: rstr })),
  summary_md: dstr,
  confidence_flags: strList,
}) satisfies z.ZodType<IntakeAnalysis, unknown>;

export const LogAnalysisSchema = z.object({
  meeting: z.preprocess(
    (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}),
    z.object({ date: nstr, channel: nstr, title: nstr })
  ),
  entries: listOf(z.object({ person_slug: rstr, summary_md: rstr, next_action: nstr })),
  unmatched_participants: strList,
  resolves_action_ids: intList,
  suggested_actions: listOf(
    z.object({ title: rstr, bucket: z.preprocess((v) => asString(v) ?? "this_week", z.string()), due: nstr, person_slug: nstr })
  ),
  summary_md: dstr,
  confidence_flags: strList,
}) satisfies z.ZodType<LogAnalysis, unknown>;

export const PrepResearchSchema = z.object({
  person_slug: nstr,
  meeting: nullableObject(z.object({ date: nstr, time: nstr, title: nstr, attendees: strList })),
  whats_changed_md: dstr,
  confidence_flags: strList,
}) satisfies z.ZodType<PrepResearch, unknown>;

const coachUpdates = {
  completed_action_ids: intList,
  new_actions: listOf(
    z.object({ title: rstr, bucket: z.preprocess((v) => asString(v) ?? "this_week", z.string()), due_label: nstr, person_slug: nstr })
  ),
};
export const CoachTurnSchema = z.object({ reply_md: rstr, ...coachUpdates }) satisfies z.ZodType<CoachTurn, unknown>;
export const CoachCloseSchema = z.object({ summary_md: rstr, ...coachUpdates }) satisfies z.ZodType<CoachClose, unknown>;

/**
 * Validate parsed model JSON against a schema. Returns the coerced value or
 * throws an Error whose message names the offending fields and quotes the
 * start of the raw text, so the draft's error state is actionable.
 */
export function validateModelJson<T extends z.ZodTypeAny>(schema: T, value: unknown, rawText: string): z.output<T> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issues = r.error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(
    `The model's answer didn't have the expected shape — ${issues}. Try again; if it keeps happening, a larger model or a lower temperature usually fixes it. Raw start: ${rawText.slice(0, 300).replace(/\s+/g, " ")}`
  );
}
