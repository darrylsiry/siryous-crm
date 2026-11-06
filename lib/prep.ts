"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "./db";
import { buildPrepPrompt } from "./ai";
import { runWithProgress } from "./progress";
import { errText, gatherResearch } from "./prepResearch";

export async function generatePrep(formData: FormData) {
  const db = getDb();
  const personId = Number(formData.get("person_id")) || null;
  const focus = String(formData.get("focus") ?? "").trim();
  const personName = personId
    ? ((db.prepare(`SELECT name FROM people WHERE id=?`).get(personId) as { name: string } | undefined)?.name ?? "Unknown")
    : "Next CRM meeting (from calendar)";
  const briefId = Number(
    db
      .prepare(`INSERT INTO briefs (person_id, title, focus, status) VALUES (?,?,?,'analyzing')`)
      .run(personId, `Prep: ${personName}`, focus || null).lastInsertRowid
  );
  after(async () => {
    try {
      const { targetId, research, researchNote } = await gatherResearch(db, briefId, personId, focus);

      // Step 2 (local model): write the brief.
      const md = await runWithProgress("prep", briefId, buildPrepPrompt(targetId, focus, research, researchNote), {
        timeoutMs: 420_000,
      });
      if (!md.trim()) throw new Error("Empty brief returned.");
      db.prepare(`UPDATE briefs SET content_md=?, status='ready' WHERE id=?`).run(md.trim(), briefId);
    } catch (err) {
      db.prepare(`UPDATE briefs SET status='error', error=? WHERE id=?`).run(errText(err), briefId);
    }
  });
  redirect(`/prep/${briefId}`);
}

export async function deleteBrief(id: number) {
  getDb().prepare(`DELETE FROM briefs WHERE id=?`).run(id);
  revalidatePath("/prep");
  redirect("/prep");
}
