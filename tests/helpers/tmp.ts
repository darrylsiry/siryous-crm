import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A throwaway directory for one test file. Every suite that touches disk uses
 * this so nothing is ever written under the project's data/ folder.
 */
export function makeTmpDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `siryous-${prefix}-`));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
