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
  if (raw) return expandHome(raw);
  const dbPath = db.name; // better-sqlite3 exposes the file path
  return path.resolve(path.dirname(dbPath), "backups");
}

/** A backup is overdue when the newest one is older than this many days. */
export const BACKUP_STALE_DAYS = 2;

/** `~/` expanded; anything else as typed. */
function expandHome(raw) {
  return raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
}

/**
 * Check a backup folder typed on the Settings page before it is saved: blank
 * (the default) and "off" are fine; anything else must be a full path to a
 * folder this process can write to, or to one it can create (its nearest
 * existing parent is a writable folder).
 */
export function validateBackupDir(raw) {
  const typed = String(raw ?? "").trim();
  if (!typed || typed.toLowerCase() === "off") return { ok: true, dir: typed };
  const dir = expandHome(typed);
  if (!path.isAbsolute(dir)) return { ok: false, reason: "give the full path to the folder (starting with / or ~/)" };
  let probe = dir;
  while (!fs.existsSync(probe)) {
    const up = path.dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  try {
    if (!fs.statSync(probe).isDirectory()) return { ok: false, reason: `${probe} is a file, not a folder` };
    fs.accessSync(probe, fs.constants.W_OK);
  } catch {
    return { ok: false, reason: `the CRM can't write to ${probe}` };
  }
  return { ok: true, dir: typed };
}

function setting(db, key, value) {
  try {
    if (value == null) db.prepare(`DELETE FROM settings WHERE key=?`).run(key);
    else db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
  } catch {
    /* settings table not there yet */
  }
}
function readSetting(db, key) {
  try {
    return db.prepare(`SELECT value FROM settings WHERE key=?`).get(key)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * What the owner should know about backups: where they go, the newest file,
 * and a warning when the last attempt failed or the newest is overdue (null
 * when all is well, or when backups are off on purpose).
 */
export function backupHealth(db, now = new Date()) {
  const { dir, file } = lastBackup(db);
  const lastError = readSetting(db, "backup.last_error");
  const lastErrorAt = readSetting(db, "backup.last_error_at");
  let warning = null;
  if (dir) {
    const newest = file?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    const today = now.toLocaleDateString("sv-SE");
    const ageDays = newest ? Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${newest}T12:00:00`)) / 86_400_000) : null;
    if (lastError) warning = `The last backup failed${lastErrorAt ? ` (${lastErrorAt.slice(0, 16).replace("T", " ")})` : ""}: ${lastError}`;
    else if (ageDays === null) warning = null; // the first one is made at start-up; nothing to warn about yet
    else if (ageDays > BACKUP_STALE_DAYS) warning = `The newest backup is ${ageDays} days old.`;
  }
  return { dir, file, lastError, warning };
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

/**
 * Make today's backup if it isn't there. The outcome is recorded in settings
 * (backup.last_error / backup.last_ok_at) so Settings and the Dashboard can
 * say when backups have stopped, not just the server log.
 * @param {import('better-sqlite3').Database} db
 */
export async function ensureDailyBackup(db) {
  let tmp = null;
  try {
    const DEST = backupDir(db);
    if (!DEST) return;
    if (!path.isAbsolute(DEST)) throw new Error(`the backup folder "${DEST}" isn't a full path`);
    const stamp = new Date().toLocaleDateString("sv-SE"); // local YYYY-MM-DD
    const target = path.join(DEST, `crm-${stamp}.db`);
    if (fs.existsSync(target)) {
      setting(db, "backup.last_error", null);
      return;
    }
    fs.mkdirSync(DEST, { recursive: true });
    // Per-process temp name: the web app and the MCP server may both start at login.
    tmp = `${target}.${process.pid}.tmp`;
    await db.backup(tmp);
    if (fs.existsSync(target)) {
      fs.unlinkSync(tmp); // the other process got there first
      tmp = null;
      setting(db, "backup.last_error", null);
      return;
    }
    fs.renameSync(tmp, target);
    tmp = null;
    setting(db, "backup.last_error", null);
    setting(db, "backup.last_error_at", null);
    setting(db, "backup.last_ok_at", new Date().toISOString());
    const old = fs
      .readdirSync(DEST)
      .filter((f) => /^crm-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .reverse()
      .slice(30);
    for (const f of old) fs.unlinkSync(path.join(DEST, f));
  } catch (err) {
    const message = String(err?.message ?? err);
    console.error("[backup] failed:", message);
    setting(db, "backup.last_error", message.slice(0, 500));
    setting(db, "backup.last_error_at", new Date().toISOString());
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}

/** Start-and-forget: back up now, then re-check every 6 hours. */
export function startBackupLoop(db) {
  ensureDailyBackup(db);
  const timer = setInterval(() => ensureDailyBackup(db), 6 * 60 * 60 * 1000);
  timer.unref?.();
}
