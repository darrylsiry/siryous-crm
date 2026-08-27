/**
 * Import this first in any script: makes the repo root the working directory
 * so relative paths (data/crm.db, exports/) resolve the same wherever the
 * script is launched from. The scripts run under tsx in CommonJS mode, so
 * `__dirname` is available.
 */
import path from "path";

process.chdir(path.resolve(__dirname, ".."));
