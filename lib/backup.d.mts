import type Database from "better-sqlite3";
export function backupDir(db: Database.Database): string | null;
export function lastBackup(db: Database.Database): { dir: string | null; file: string | null };
export const BACKUP_STALE_DAYS: number;
export function validateBackupDir(raw: string): { ok: true; dir: string } | { ok: false; reason: string };
export function backupHealth(
  db: Database.Database,
  now?: Date
): { dir: string | null; file: string | null; lastError: string | null; warning: string | null };
export function ensureDailyBackup(db: Database.Database): Promise<void>;
export function startBackupLoop(db: Database.Database): void;
