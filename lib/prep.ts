"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "./db";
import { buildPrepPrompt, buildPrepResearchPrompt, extractJsonWithRepair, TOOLS, type PrepResearch } from "./ai";
import { noteProgress, runWithProgress } from "./progress";
import { PrepResearchSchema, validateModelJson } from "./schemas";

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
      // Step 1 (Claude + Calendar/Gmail/web): what's new since the CRM log —
      // and, when no person was chosen, which meeting is next. Not fatal if it
      // fails for a chosen person; fatal only if we still don't know who.
      let research: PrepResearch | null = null;
      let researchNote: string | null = null;
      let targetId = personId;
      try {
        const raw = await runWithProgress("prep", briefId, buildPrepResearchPrompt(personId, focus), {
          allowedTools: [TOOLS.calendarRead, TOOLS.gmailRead, TOOLS.web].join(","),
          timeoutMs: 420_000,
        });
        research = validateModelJson(PrepResearchSchema, await extractJsonWithRepair(raw), raw) as PrepResearch;
      } catch (err) {
        researchNote = err instanceof Error ? err.message : String(err);
        noteProgress("prep", briefId, "External research skipped — writing from the CRM dossier only", researchNote);
      }
      if (!targetId) {
        const slug = research?.person_slug ?? null;
        const found = slug
          ? (db.prepare(`SELECT id, name FROM people WHERE slug=?`).get(slug) as { id: number; name: string } | undefined)
          : undefined;
        if (!found) {
          throw new Error(
            research
              ? `No CRM-relevant meeting was found in the next 7 days${research.confidence_flags?.length ? ` (${research.confidence_flags.join("; ")})` : ""}. Pick a person instead.`
              : `Couldn't scan the calendar (${researchNote}). Pick a person instead.`
          );
        }
        targetId = found.id;
        db.prepare(`UPDATE briefs SET person_id=?, title=? WHERE id=?`).run(found.id, `Prep: ${found.name}`, briefId);
      }
      // Step 2 (local model): write the brief.
      const md = await runWithProgress("prep", briefId, buildPrepPrompt(targetId, focus, research, researchNote), {
        timeoutMs: 420_000,
      });
      if (!md.trim()) throw new Error("Empty brief returned.");
      db.prepare(`UPDATE briefs SET content_md=?, status='ready' WHERE id=?`).run(md.trim(), briefId);
    } catch (err) {
      db.prepare(`UPDATE briefs SET status='error', error=? WHERE id=?`).run(
        err instanceof Error ? err.message : String(err),
        briefId
      );
    }
  });
  redirect(`/prep/${briefId}`);
}

export async function deleteBrief(id: number) {
  getDb().prepare(`DELETE FROM briefs WHERE id=?`).run(id);
  revalidatePath("/prep");
  redirect("/prep");
}
