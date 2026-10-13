import Database from "better-sqlite3";
import path from "path";
import { openDatabase } from "./schema.mjs";
import { loadVocab } from "./vocab.mjs";

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

/**
 * Vocabulary (statuses, buckets, stages, kinds, strengths, cadences) comes from
 * lib/vocab.mjs: built-in defaults merged with the gitignored config/vocab.json.
 * Colours are already resolved to Tailwind class strings.
 */
export const VOCAB = loadVocab();

export const STATUS: Record<string, { emoji: string; label: string; color: string }> = VOCAB.status;

export const BUCKETS: Record<string, { label: string; icon: string; order: number }> = VOCAB.buckets;

export const STRENGTHS: readonly string[] = VOCAB.strengths;

export const STAGES: Record<string, { label: string; icon: string; color: string; order: number; open: boolean }> = VOCAB.stages;

export const KINDS: Record<string, { label: string; badge: string; separate: boolean; card: string | null }> = VOCAB.kinds;

/** Stable sort that moves opportunities of a "separate" kind (job opportunities) after the rest. */
export function separateKindsLast<T extends { kind: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(KINDS[a.kind]?.separate ?? false) - Number(KINDS[b.kind]?.separate ?? false));
}

/** Default keep-warm cadence (days) by pipeline status; null = no cadence. Every status has an entry. */
export const DEFAULT_CADENCE: Record<string, number | null> = Object.fromEntries(
  Object.keys(STATUS).map((k) => [k, VOCAB.cadence[k] ?? null])
);
