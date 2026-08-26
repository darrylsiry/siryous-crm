import type Database from "better-sqlite3";
export function openDatabase(DatabaseCtor: typeof Database, dbPath: string): Database.Database;
export function initSchema(db: Database.Database): void;
