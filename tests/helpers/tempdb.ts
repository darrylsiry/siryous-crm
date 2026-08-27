import path from "node:path";
import { makeTmpDir } from "./tmp";

/**
 * Import this BEFORE anything that pulls in lib/db.ts (queries, settings,
 * auth, proxy…). It points CRM_DB_PATH at a throwaway file so the suite never
 * opens data/crm.db. Imports are evaluated in source order, so putting this
 * first in a test file is enough; `node --test` runs each file in its own
 * process, so the directory is private to that file.
 */
export const tmp = makeTmpDir("db");
export const dbPath = path.join(tmp.dir, "crm.db");
process.env.CRM_DB_PATH = dbPath;
// Prompts must read the same on every machine: ignore any config/owner.json
// (and vocab) the developer has, unless a test sets these itself.
process.env.OWNER_CONFIG ??= path.join(tmp.dir, "no-owner.json");
