import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "../lib/schema.mjs";
import { backupHealth, ensureDailyBackup, validateBackupDir } from "../lib/backup.mjs";
import { makeTmpDir } from "./helpers/tmp";

const tmp = makeTmpDir("backup");
const db = openDatabase(Database, path.join(tmp.dir, "crm.db")) as Database.Database;
after(() => {
  db.close();
  tmp.cleanup();
});
const setDir = (dir: string) =>
  db.prepare(`INSERT INTO settings (key, value) VALUES ('backup.dir', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(dir);

describe("the backup folder setting", () => {
  test("blank, off, and a folder that can be created are accepted", () => {
    assert.deepEqual(validateBackupDir(""), { ok: true, dir: "" });
    assert.deepEqual(validateBackupDir("off"), { ok: true, dir: "off" });
    assert.equal(validateBackupDir(path.join(tmp.dir, "new", "deeper")).ok, true);
  });

  test("a relative path, a file and a read-only folder are refused", () => {
    assert.match((validateBackupDir("backups") as { reason: string }).reason, /full path/);
    const file = path.join(tmp.dir, "a-file");
    fs.writeFileSync(file, "");
    assert.match((validateBackupDir(file) as { reason: string }).reason, /is a file/);
    const ro = path.join(tmp.dir, "read-only");
    fs.mkdirSync(ro);
    fs.chmodSync(ro, 0o555);
    try {
      assert.match((validateBackupDir(path.join(ro, "backups")) as { reason: string }).reason, /can't write/);
    } finally {
      fs.chmodSync(ro, 0o755);
    }
  });
});

describe("a failing backup", () => {
  test("is recorded and shown, leaves no temp file, and clears once a backup works", async () => {
    const ro = path.join(tmp.dir, "locked");
    fs.mkdirSync(ro);
    fs.chmodSync(ro, 0o555);
    setDir(ro);
    try {
      await ensureDailyBackup(db);
      const health = backupHealth(db);
      assert.ok(health.lastError);
      assert.match(health.warning ?? "", /last backup failed/);
      assert.deepEqual(fs.readdirSync(ro), []);
    } finally {
      fs.chmodSync(ro, 0o755);
    }
    await ensureDailyBackup(db);
    const health = backupHealth(db);
    assert.equal(health.lastError, null);
    assert.equal(health.warning, null);
    assert.match(health.file ?? "", /^crm-\d{4}-\d{2}-\d{2}\.db$/);
  });

  test("a relative folder (e.g. from CRM_BACKUP_DIR) is an error, not a folder under the working directory", async () => {
    setDir("relative/backups");
    await ensureDailyBackup(db);
    assert.match(backupHealth(db).lastError ?? "", /isn't a full path/);
    assert.equal(fs.existsSync(path.resolve("relative")), false);
  });

  test("an old newest backup is a warning", () => {
    const dir = path.join(tmp.dir, "old");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "crm-2026-01-01.db"), "");
    setDir(dir);
    db.prepare(`DELETE FROM settings WHERE key LIKE 'backup.last_error%'`).run();
    assert.match(backupHealth(db, new Date("2026-01-05T12:00:00")).warning ?? "", /4 days old/);
    assert.equal(backupHealth(db, new Date("2026-01-02T12:00:00")).warning, null);
  });

  test("backups turned off never warn", () => {
    setDir("off");
    assert.equal(backupHealth(db).warning, null);
  });
});
