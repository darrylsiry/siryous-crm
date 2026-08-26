import type Database from "better-sqlite3";
export function backupDir(db: Database.Database): string | null;
export function lastBackup(db: Database.Database): { dir: string | null; file: string | null };
export function ensureDailyBackup(db: Database.Database): Promise<void>;
export function startBackupLoop(db: Database.Database): void;
