/**
 * What a brief's research really covered, from the record its run saved
 * (briefs.checks), not from what the model chose to say: "Checked: your CRM,
 * Calendar and Gmail · Not checked: the web (the search failed)". Used above
 * the brief and at the top of its Word export.
 */
export interface BriefChecks {
  checked: string[];
  notChecked: { what: string; why: string }[];
}

/** Shorten a step's failure to one plain clause for the line. */
function why(note: string): string {
  const s = note.replace(/\s*\(Detail:[\s\S]*$/, "").replace(/\s+/g, " ").trim();
  return s.length > 140 ? `${s.slice(0, 139)}…` : s;
}

export function briefChecks(raw: string | null | undefined): BriefChecks | null {
  if (!raw) return null;
  let c: { connector?: string | null; web?: string | null };
  try {
    c = JSON.parse(raw);
  } catch {
    return null;
  }
  const out: BriefChecks = { checked: ["your CRM"], notChecked: [] };
  if (c.connector) out.notChecked.push({ what: "Calendar and Gmail", why: why(c.connector) });
  else out.checked.push("Calendar and Gmail");
  if (c.web) out.notChecked.push({ what: "the web", why: why(c.web) });
  else out.checked.push("the web");
  return out;
}

export function briefChecksLine(c: BriefChecks): string {
  const checked = `Checked: ${c.checked.join(", ")}`;
  return c.notChecked.length ? `${checked} · Not checked: ${c.notChecked.map((n) => `${n.what} (${n.why})`).join("; ")}` : checked;
}
