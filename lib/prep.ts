"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "./db";
import {
  buildPrepConnectorPrompt,
  buildPrepPrompt,
  buildPrepWebPrompt,
  extractJsonWithRepair,
  TOOLS,
  type PrepResearch,
} from "./ai";
import { noteProgress, runWithProgress } from "./progress";
import { PrepResearchSchema, validateModelJson } from "./schemas";

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
      // Step 1a (Claude + Calendar/Gmail read tools, NO web tools): what's new
      // in correspondence and on the calendar — and, when no person was
      // chosen, which meeting is next. Not fatal if it fails for a chosen
      // person; fatal only if we still don't know who.
      let connector: PrepResearch | null = null;
      let connectorNote: string | null = null;
      let targetId = personId;
      try {
        const raw = await runWithProgress("prep", briefId, buildPrepConnectorPrompt(personId, focus), {
          allowedTools: [TOOLS.calendarRead, TOOLS.gmailRead].join(","),
          timeoutMs: 420_000,
        });
        connector = validateModelJson(PrepResearchSchema, await extractJsonWithRepair(raw), raw) as PrepResearch;
      } catch (err) {
        connectorNote = errText(err);
        noteProgress("prep", briefId, "Calendar/Gmail check skipped", connectorNote);
      }
      if (!targetId) {
        const slug = connector?.person_slug ?? null;
        const found = slug
          ? (db.prepare(`SELECT id, name FROM people WHERE slug=?`).get(slug) as { id: number; name: string } | undefined)
          : undefined;
        if (!found) {
          throw new Error(
            connector
              ? `No CRM-relevant meeting was found in the next 7 days${connector.confidence_flags?.length ? ` (${connector.confidence_flags.join("; ")})` : ""}. Pick a person instead.`
              : `Couldn't scan the calendar (${connectorNote}). Pick a person instead.`
          );
        }
        targetId = found.id;
        db.prepare(`UPDATE briefs SET person_id=?, title=? WHERE id=?`).run(found.id, `Prep: ${found.name}`, briefId);
      }

      // Step 1b (Claude + web tools only, public facts only): recent public
      // news. Runs in its own CLI session so it never sees the connector
      // data, and vice versa. Independent of step 1a: either can fail alone.
      let web: string | null = null;
      let webNote: string | null = null;
      try {
        noteProgress("prep", briefId, "Checking the web for recent public news (separate session, public facts only)");
        web = (await runWithProgress("prep", briefId, buildPrepWebPrompt(targetId), {
          allowedTools: TOOLS.web,
          timeoutMs: 300_000,
        })).trim();
        if (!web) throw new Error("Empty response.");
      } catch (err) {
        webNote = errText(err);
        noteProgress("prep", briefId, "Web research skipped", webNote);
      }

      // Merge: connector bullets + web bullets; the caveats name whatever was skipped.
      const research = mergeResearch(connector, connectorNote, web, webNote);
      const researchNote =
        research === null
          ? [connectorNote && `Calendar/Gmail: ${connectorNote}`, webNote && `web: ${webNote}`].filter(Boolean).join("; ")
          : null;
      if (research === null) {
        noteProgress("prep", briefId, "External research unavailable — writing from the CRM dossier only");
      }

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

/**
 * Combine the two research steps into the single PrepResearch the writer
 * expects. Null only when both failed; a lone failure becomes a caveat.
 */
function mergeResearch(
  connector: PrepResearch | null,
  connectorNote: string | null,
  web: string | null,
  webNote: string | null
): PrepResearch | null {
  if (!connector && web === null) return null;
  const bullets = [connector?.whats_changed_md?.trim(), web?.trim()].filter(Boolean).join("\n");
  const flags = [...(connector?.confidence_flags ?? [])];
  if (!connector) flags.push(`Calendar and Gmail were not checked (${connectorNote ?? "step failed"}) — only public web news is included.`);
  if (web === null) flags.push(`The web was not checked (${webNote ?? "step failed"}) — only Calendar/Gmail findings are included.`);
  return {
    person_slug: connector?.person_slug ?? null,
    meeting: connector?.meeting ?? null,
    whats_changed_md: bullets || "- nothing found",
    confidence_flags: flags,
  };
}

export async function deleteBrief(id: number) {
  getDb().prepare(`DELETE FROM briefs WHERE id=?`).run(id);
  revalidatePath("/prep");
  redirect("/prep");
}
