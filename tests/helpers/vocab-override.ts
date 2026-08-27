import fs from "node:fs";
import path from "node:path";
import { tmp } from "./tempdb";

/**
 * Import this BEFORE lib/db.ts (after ./tempdb) to load the app with a test
 * vocabulary: one extra bucket and one kind removed. ES imports are hoisted,
 * so setting VOCAB_CONFIG in the test body itself would be too late.
 */
export const overrideFile = path.join(tmp.dir, "vocab.json");
fs.writeFileSync(
  overrideFile,
  JSON.stringify({
    buckets: { board_prep: { label: "Board prep", icon: "🏛️", order: 2.5 } },
    kinds: { remove: ["venture"] },
  })
);
process.env.VOCAB_CONFIG = overrideFile;
