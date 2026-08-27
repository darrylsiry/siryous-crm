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
