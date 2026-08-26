/**
 * Self-backup: whenever the app or MCP server is running, make sure today's
 * database backup exists. Called at process start and then periodically.
 * Keeps the newest 30 backups.
 *
 * The processes that already touch the DB do this (rather than a cron/launchd
 * job) so a backup happens on every day the data can change, with no extra
 * setup on the user's machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where backups go. Resolution order: the `backup.dir` setting (Settings page,
 * stored in the database, shared by the web app and the MCP server), then the
 * CRM_BACKUP_DIR environment variable, then data/backups next to the database.
 * An explicit "off" disables backups. Nothing is ever written to a cloud folder
 * unless you point it there.
 */
export function backupDir(db) {
  let configured = null;
  try {
    configured = db.prepare(`SELECT value FROM settings WHERE key='backup.dir'`).get()?.value ?? null;
  } catch {
    /* settings table not there yet */
  }
  const raw = (configured ?? process.env.CRM_BACKUP_DIR ?? "").trim();
  if (raw.toLowerCase() === "off") return null;
  if (raw) return raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  const dbPath = db.name; // better-sqlite3 exposes the file path
  return path.join(path.dirname(dbPath), "backups");
}

/** Newest backup file in the configured directory, for the Settings page. */
export function lastBackup(db) {
  const dir = backupDir(db);
  if (!dir) return { dir: null, file: null };
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^crm-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort();
    return { dir, file: files[files.length - 1] ?? null };
  } catch {
    return { dir, file: null };
  }
}

/** @param {import('better-sqlite3').Database} db */
export async function ensureDailyBackup(db) {
  try {
    const DEST = backupDir(db);
    if (!DEST) return;
    const stamp = new Date().toLocaleDateString("sv-SE"); // local YYYY-MM-DD
    const target = path.join(DEST, `crm-${stamp}.db`);
    if (fs.existsSync(target)) return;
    fs.mkdirSync(DEST, { recursive: true });
    // Per-process temp name: the web app and the MCP server may both start at login.
    const tmp = `${target}.${process.pid}.tmp`;
    await db.backup(tmp);
    if (fs.existsSync(target)) {
      fs.unlinkSync(tmp); // the other process got there first
      return;
    }
    fs.renameSync(tmp, target);
    const old = fs
      .readdirSync(DEST)
      .filter((f) => /^crm-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .reverse()
      .slice(30);
    for (const f of old) fs.unlinkSync(path.join(DEST, f));
  } catch (err) {
    console.error("[backup] failed:", err?.message ?? err);
  }
}

/** Start-and-forget: back up now, then re-check every 6 hours. */
export function startBackupLoop(db) {
  ensureDailyBackup(db);
  const timer = setInterval(() => ensureDailyBackup(db), 6 * 60 * 60 * 1000);
  timer.unref?.();
}
