// Runs once when the Next.js server boots.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("./lib/db");
    const { startBackupLoop } = await import("./lib/backup.mjs");
    const { authEnabled, signInUrl, tokenPath } = await import("./lib/auth.mjs");
    const db = getDb();

    if (authEnabled()) {
      const port = process.env.PORT || "3000";
      console.log(`[auth] sign in at ${signInUrl(`http://127.0.0.1:${port}`)}  (token file: ${tokenPath()}; CRM_AUTH=off disables)`);
    } else {
      console.log("[auth] CRM_AUTH=off — no access token required");
    }

    // AI runs live in after() callbacks; a restart mid-run would otherwise
    // leave the row "analyzing" forever (and a stuck weekly coach session
    // blocks the whole week). Mark them failed so the UI offers a retry.
    const note = "Interrupted by a server restart — start it again.";
    for (const table of ["intake_drafts", "log_drafts", "briefs", "coach_sessions"]) {
      try {
        // A draft caught mid-confirm just goes back to reviewable.
        db.prepare(`UPDATE ${table} SET status='ready' WHERE status='confirming'`).run();
        const n = db
          .prepare(`UPDATE ${table} SET status='error', error=? WHERE status IN ('analyzing','pending')`)
          .run(note).changes;
        if (n) console.log(`[startup] marked ${n} interrupted run(s) in ${table} as failed`);
      } catch {
        /* table missing on a very old DB — schema init will add it */
      }
    }

    startBackupLoop(db);
  }
}
