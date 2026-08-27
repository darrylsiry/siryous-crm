// Runs once when the Next.js server boots.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("./lib/db");
    const { startBackupLoop } = await import("./lib/backup.mjs");
    const { authEnabled, signInUrl, tokenPath, wasJustCreated } = await import("./lib/auth.mjs");
    const db = getDb();

    if (authEnabled()) {
      const port = process.env.PORT || "3000";
      const url = signInUrl(`http://127.0.0.1:${port}`);
      const firstRun = wasJustCreated();
      const rule = "─".repeat(72);
      console.log(`\n${rule}\nOPEN THIS LINK to use the CRM (it signs you in):\n${url}\n${rule}`);
      console.log(`[auth] sign-in code file: ${tokenPath()} (CRM_AUTH=off disables sign-in)`);
      if (firstRun) openInBrowser(url);
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

    // A coach reply/close that was mid-run when the server died still holds
    // the session's in_flight lock; nothing will ever release it, so clear
    // them all (the schema migration has just added the column if needed).
    try {
      const n = db.prepare(`UPDATE coach_sessions SET in_flight=NULL WHERE in_flight IS NOT NULL`).run().changes;
      if (n) console.log(`[startup] released ${n} stale coach session lock(s)`);
    } catch {
      /* column missing on a very old DB */
    }

    startBackupLoop(db);
  }
}

/**
 * First run only: nobody has ever signed a browser in, so open the sign-in
 * link for them. Best effort — a headless machine, a missing opener, or a
 * launcher that opens the browser itself (set CRM_NO_OPEN=1) must not break
 * startup.
 */
async function openInBrowser(url: string) {
  if (process.env.CRM_NO_OPEN === "1" || process.env.NODE_ENV === "test") return;
  try {
    const { spawn } = await import("child_process");
    const [cmd, args] =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", "", url]]
          : ["xdg-open", [url]];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    console.log("[auth] first run — opening the sign-in link in your browser");
  } catch {
    /* no opener on this machine — the link is printed above */
  }
}
