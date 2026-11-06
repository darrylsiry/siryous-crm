"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "./db";
import { buildPrepPrompt, claudeAvailable } from "./ai";
import { runWithProgress } from "./progress";
import { RunCancelled } from "./llm";
import { errText, gatherResearch } from "./prepResearch";

export async function generatePrep(formData: FormData) {
  const db = getDb();
  const personId = Number(formData.get("person_id")) || null;
  const focus = String(formData.get("focus") ?? "").trim();
  // "Auto" reads the calendar, which needs Claude; without it a person must be chosen.
  if (!personId && !claudeAvailable()) redirect("/prep?pick=1");
  const personName = personId
    ? ((db.prepare(`SELECT name FROM people WHERE id=?`).get(personId) as { name: string } | undefined)?.name ?? "Unknown")
    : "Next CRM meeting (from calendar)";
  const briefId = Number(
    db
      .prepare(`INSERT INTO briefs (person_id, title, focus, status) VALUES (?,?,?,'analyzing')`)
      .run(personId, `Prep: ${personName}`, focus || null).lastInsertRowid
  );
  after(() => writeBrief(briefId, personId, focus));
  redirect(`/prep/${briefId}`);
}

/** The research steps, then the brief itself. Never throws: a failure is recorded on the brief. */
async function writeBrief(briefId: number, personId: number | null, focus: string) {
  const db = getDb();
  try {
    const { targetId, research, researchNote, checks } = await gatherResearch(db, briefId, personId, focus);
    db.prepare(`UPDATE briefs SET checks=? WHERE id=?`).run(JSON.stringify(checks), briefId);

    // Step 2 (local model): write the brief.
    const md = await runWithProgress("prep", briefId, buildPrepPrompt(targetId, focus, research, researchNote), {
      timeoutMs: 420_000,
    });
    if (!md.trim()) throw new Error("Empty brief returned.");
    db.prepare(`UPDATE briefs SET content_md=?, status='ready' WHERE id=?`).run(md.trim(), briefId);
  } catch (err) {
    // A cancelled brief already says so (lib/progress.ts cancelRun).
    if (err instanceof RunCancelled) return;
    db.prepare(`UPDATE briefs SET status='error', error=? WHERE id=? AND status='analyzing'`).run(errText(err), briefId);
  }
}

/** Try a failed brief again, for the same person and focus. */
export async function retryPrep(id: number) {
  const db = getDb();
  const row = db.prepare(`SELECT person_id, focus FROM briefs WHERE id=? AND status='error'`).get(id) as
    | { person_id: number | null; focus: string | null }
    | undefined;
  if (row) {
    db.prepare(`UPDATE briefs SET status='analyzing', error=NULL, progress=NULL, content_md=NULL, checks=NULL WHERE id=?`).run(id);
    after(() => writeBrief(id, row.person_id, row.focus ?? ""));
  }
  redirect(`/prep/${id}`);
}

export async function deleteBrief(id: number) {
  getDb().prepare(`DELETE FROM briefs WHERE id=?`).run(id);
  revalidatePath("/prep");
  redirect("/prep");
}
