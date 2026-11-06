/**
 * Owner profile: who this CRM is for. Read from config/owner.json (gitignored;
 * copy config/owner.example.json to start) with sane generic defaults, so the
 * same code serves any practice without editing prompts. Plain JS so both the
 * Next.js app and the MCP server can import it. Read once per process.
 *
 * Override the file location with OWNER_CONFIG=/path/to/owner.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULTS = {
  appName: "Siryous CRM",
  ownerName: "the owner",
  ownerFirstName: "the owner",
  ownerEmail: "",
  practiceName: "the practice",
  practiceDescription: "independent advisory practice",
  researchTriggers: "funding, leadership changes, M&A, new initiatives relevant to the practice",
  coachPersona: "",
  coachContextDir: "",
  coachContextGuidance: "",
  mcpServerName: "siryous-crm",
};

/**
 * Values the example file used to ship with (and the hints it ships with
 * now). A copy left half-edited must not make the coach describe someone
 * else's business, so a field still holding one of these counts as unset.
 */
const SAMPLE_VALUES = new Set([
  "Jane Doe",
  "Jane",
  "jane@example.com",
  "Doe Advisory",
  "independent consulting practice focused on operations and go-to-market for mid-market SaaS companies",
  "funding rounds, leadership changes, M&A, product launches, hiring in ops/GTM",
  "You are Jane Doe's executive coach. Jane runs Doe Advisory solo, sells a small number of high-trust engagements, and is building her brand through a newsletter and LinkedIn. Ground every observation in the data provided; name specific people, deals, and numbers. Never invent activity that isn't in the data.",
  "~/Documents/coach-context",
  "These are Jane's own notes on strengths, pitfalls and what this phase of her career is for. Treat them as ground truth about how she works and hold her to her own definition of success.",
]);

/** The fields Settings → About you can set, written back into config/owner.json. */
export const OWNER_FORM_FIELDS = ["ownerName", "ownerFirstName", "ownerEmail", "practiceName", "practiceDescription"];

function expandHome(p) {
  return p && p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

let cached = null;

/** Forget the cached profile, so the next loadOwner() reads the file again (after Settings saves it). */
export function resetOwner() {
  cached = null;
}

/** @param {string} [root] project root (defaults to cwd) */
export function loadOwner(root = process.cwd()) {
  if (cached) return cached;
  const file = process.env.OWNER_CONFIG || path.join(root, "config", "owner.json");
  let fromFile = {};
  let readError = null;
  let text = null;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    /* no config yet — generic defaults */
  }
  if (text !== null) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fromFile = parsed;
      else readError = "it isn't a JSON object";
    } catch (err) {
      // Often curly quotes from TextEdit. Say so instead of quietly using the defaults.
      readError = /[\u201c\u201d\u2018\u2019]/.test(text) ? "it has curly quotes (“ ”) where JSON needs straight ones (\")" : String(err?.message ?? err);
    }
  }
  const o = { ...DEFAULTS };
  const ignoredSamples = [];
  for (const k of Object.keys(DEFAULTS)) {
    const v = typeof fromFile[k] === "string" ? fromFile[k].trim() : "";
    if (!v) continue;
    if (SAMPLE_VALUES.has(v)) {
      ignoredSamples.push(k);
      continue;
    }
    o[k] = v;
  }
  o.coachContextDir = expandHome(o.coachContextDir);
  o.configured = o.ownerName !== DEFAULTS.ownerName;
  o.configPath = file;
  o.readError = readError;
  o.ignoredSamples = ignoredSamples;
  // A first name defaults to the first word of the name.
  if (o.configured && o.ownerFirstName === DEFAULTS.ownerFirstName) o.ownerFirstName = o.ownerName.split(/\s+/)[0];
  // Sentence helpers used by the prompts.
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  o.first = o.ownerFirstName; // "Jane" / "the owner"
  o.First = cap(o.ownerFirstName); // "Jane" / "The owner"
  o.possessive = o.ownerFirstName.endsWith("s") ? `${o.ownerFirstName}'` : `${o.ownerFirstName}'s`;
  o.Possessive = cap(o.possessive);
  // "Doe Advisory — Jane Doe's independent consulting practice" / "the owner's independent advisory practice"
  o.practiceIntro = o.configured
    ? `${o.practiceName} — ${o.ownerName}'s ${o.practiceDescription}`
    : `${o.ownerName}'s ${o.practiceDescription}`;
  cached = o;
  return o;
}
