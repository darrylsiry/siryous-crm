import type Database from "better-sqlite3";
export function slugify(name: string): string;
export function slugFor(name: string, kind: "person" | "company"): string;
export function profilePath(table: "people" | "companies", slug: string): string;
export function effectiveBucketSql(alias?: string): string;
export function markActionDone(db: Database.Database, id: number): number;
export function daysSinceTouchSql(alias?: string): string;
export function daysOver(cadenceDays: number | null, daysSince: number | null): number | null;
export function bumpLastTouch(db: Database.Database, table: "people" | "companies", id: number, date: string): void;
export function applyStatusCadence(
  db: Database.Database,
  personId: number,
  oldStatus: string,
  newStatus: string,
  cadence: Record<string, number | null>
): void;
export function likeNeedle(q: string): string;
export const LIKE_ESCAPE: string;
export function likeAnySql(columns: string[], param?: string, alias?: string): string;
export const PEOPLE_SEARCH_COLUMNS: string[];
export const COMPANY_SEARCH_COLUMNS: string[];
