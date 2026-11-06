/**
 * Prep's research steps (Claude with read-only tools), apart from the server
 * action in lib/prep.ts so they can be tested: the Calendar/Gmail check and
 * the web check, each allowed to fail alone, merged into what the writer gets.
 */
import type Database from "better-sqlite3";
import { buildPrepConnectorPrompt, buildPrepWebPrompt, extractJsonWithRepair, TOOLS, type PrepResearch } from "./ai";
import { noteProgress, readProgress, runWithProgress } from "./progress";
import { PrepResearchSchema, validateModelJson } from "./schemas";

export const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Run a research step and insist it used one of `kinds` of tool (as logged in
 * the brief's activity feed). An answer from a step that never looked at
 * anything would otherwise read as "nothing found".
 */
async function researched(briefId: number, kinds: string[], what: string, run: () => Promise<string>): Promise<string> {
  const before = readProgress("prep", briefId)?.events.length ?? 0;
  const text = await run();
  const used = (readProgress("prep", briefId)?.events ?? []).slice(before).some((e) => kinds.includes(e.t));
  if (!used) throw new Error(`the ${what} check never ran, so nothing was checked.`);
  return text;
}

export interface GatheredResearch {
  /** The person the brief is for: the one chosen, or the one the calendar's next meeting is with. */
  targetId: number;
  /** null when neither step could check anything. */
  research: PrepResearch | null;
  /** Why there is no research, for the writer (when `research` is null). */
  researchNote: string | null;
  /** Per step: null when it checked, else why it didn't. Saved on the brief and shown above it. */
  checks: { connector: string | null; web: string | null };
}

/** Both research steps for a brief. Throws only when no person was chosen and none could be found. */
export async function gatherResearch(db: Database.Database, briefId: number, personId: number | null, focus: string): Promise<GatheredResearch> {
  // Step 1a (Claude + Calendar/Gmail read tools, NO web tools): what's new
  // in correspondence and on the calendar — and, when no person was
  // chosen, which meeting is next. Not fatal if it fails for a chosen
  // person; fatal only if we still don't know who.
  // `picked`: the step's answer, used to choose the meeting; `connector`:
  // the same answer once it is known to hold findings, used as research.
  let picked: PrepResearch | null = null;
  let connector: PrepResearch | null = null;
  let connectorNote: string | null = null;
  let targetId = personId;
  try {
    const raw = await researched(briefId, ["calendar", "gmail"], "Calendar/Gmail", () =>
      runWithProgress("prep", briefId, buildPrepConnectorPrompt(personId, focus), {
        allowedTools: [TOOLS.calendarRead, TOOLS.gmailRead].join(","),
        timeoutMs: 420_000,
      })
    );
    picked = validateModelJson(PrepResearchSchema, await extractJsonWithRepair(raw), raw) as PrepResearch;
    if (!picked.whats_changed_md.trim()) throw new Error("the Calendar/Gmail check came back without its findings.");
    connector = picked;
  } catch (err) {
    connectorNote = errText(err);
    noteProgress("prep", briefId, "Calendar/Gmail check skipped", connectorNote);
  }
  if (!targetId) {
    const slug = picked?.person_slug ?? null;
    const found = slug
      ? (db.prepare(`SELECT id, name FROM people WHERE slug=?`).get(slug) as { id: number; name: string } | undefined)
      : undefined;
    if (!found) {
      throw new Error(
        picked
          ? `No CRM-relevant meeting was found in the next 7 days${picked.confidence_flags?.length ? ` (${picked.confidence_flags.join("; ")})` : ""}. Pick a person instead.`
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
    const found = (
      await researched(briefId, ["search", "fetch"], "web", () =>
        runWithProgress("prep", briefId, buildPrepWebPrompt(targetId), {
          allowedTools: TOOLS.web,
          timeoutMs: 300_000,
        })
      )
    ).trim();
    if (!found) throw new Error("Empty response.");
    web = found; // only now: a skipped step must read as "not checked", not "nothing found"
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
  return { targetId, research, researchNote, checks: { connector: connectorNote, web: webNote } };
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
