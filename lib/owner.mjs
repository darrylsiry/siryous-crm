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

function expandHome(p) {
  return p && p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

let cached = null;

/** @param {string} [root] project root (defaults to cwd) */
export function loadOwner(root = process.cwd()) {
  if (cached) return cached;
  const file = process.env.OWNER_CONFIG || path.join(root, "config", "owner.json");
  let fromFile = {};
  try {
    fromFile = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* no config yet — generic defaults */
  }
  const o = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (typeof fromFile[k] === "string" && fromFile[k].trim()) o[k] = fromFile[k].trim();
  }
  o.coachContextDir = expandHome(o.coachContextDir);
  o.configured = Boolean(fromFile.ownerName);
  o.configPath = file;
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
