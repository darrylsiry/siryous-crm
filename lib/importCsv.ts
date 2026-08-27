/**
 * Bulk CSV import of people (and the companies they reference).
 *
 * Dependency-free: an RFC-4180-tolerant parser (quoted fields, embedded
 * commas / newlines / doubled quotes, CRLF, a UTF-8 BOM, a preamble before the
 * header row such as the "Notes:" block LinkedIn puts at the top of
 * Connections.csv) and an importer that maps columns to people fields by
 * flexible header matching. Used by `scripts/import-csv.ts` and the /import
 * page; the whole import runs in one transaction and never overwrites an
 * existing profile.
 */
import type Database from "better-sqlite3";
import { DEFAULT_CADENCE, STATUS } from "./db";
import { slugify } from "./slug";

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export interface CsvRecord {
  /** 1-based line number on which the record starts (for error messages). */
  line: number;
  fields: string[];
}

/** Parse CSV text into records. Blank records are dropped. */
export function parseCsvRecords(text: string): CsvRecord[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let sawContent = false; // whether the current record has any characters at all

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    if (sawContent && fields.some((f) => f.trim() !== "")) records.push({ line: recordLine, fields });
    fields = [];
    sawContent = false;
    recordLine = line;
  };

  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      // A quote opening an otherwise-empty field starts a quoted section; a
      // quote in the middle of an unquoted field is kept literally (tolerant).
      if (field === "") quoted = true;
      else field += c;
      sawContent = true;
    } else if (c === ",") {
      endField();
      sawContent = true;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      line++;
      endRecord();
    } else if (c === "\n") {
      line++;
      endRecord();
    } else {
      field += c;
      sawContent = true;
    }
  }
  if (sawContent || field !== "" || fields.length) endRecord();
  return records;
}

/** Parse CSV text into a plain array of rows. */
export function parseCsv(text: string): string[][] {
  return parseCsvRecords(text).map((r) => r.fields);
}

// ---------------------------------------------------------------------------
// Header mapping
// ---------------------------------------------------------------------------

export const IMPORT_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "email",
  "linkedin",
  "role_title",
  "company",
  "location",
  "phone",
  "tags",
  "notes",
  "status",
  "cadence_days",
  "last_touch",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Header synonyms, compared after `normHeader`. First match per field wins. */
const SYNONYMS: Record<ImportField, string[]> = {
  name: ["name", "full name", "contact", "contact name", "person", "display name"],
  first_name: ["first name", "firstname", "given name", "first", "forename"],
  last_name: ["last name", "lastname", "surname", "family name", "last"],
  email: ["email", "e mail", "email address", "e mail address", "mail", "primary email", "email 1", "work email"],
  linkedin: ["linkedin", "url", "linkedin url", "linkedin profile", "profile url", "profile", "link", "public profile url"],
  role_title: ["role title", "role", "title", "position", "job title", "job", "headline", "role / title"],
  company: ["company", "company name", "organization", "organisation", "employer", "org", "current company", "firm"],
  location: ["location", "city", "region", "geo", "area", "country", "based in"],
  phone: ["phone", "phone number", "mobile", "cell", "telephone", "tel", "mobile phone", "phone 1"],
  tags: ["tags", "tag", "labels", "label", "groups", "group", "category"],
  notes: ["notes", "note", "comments", "comment", "description", "about"],
  status: ["status", "status key", "crm status", "relationship status"],
  cadence_days: ["cadence days", "cadence", "keep warm", "keep warm cadence", "follow up cadence", "cadence in days"],
  last_touch: ["last touch", "last touch date", "last contact", "last contacted", "last interaction", "connected on", "connected", "last seen"],
};

function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type HeaderMapping = Partial<Record<ImportField, number>>;

/** Map header cells to import fields; returns the mapping and the headers left unused. */
export function mapHeaders(headers: string[]): { mapping: HeaderMapping; unmapped: string[] } {
  const mapping: HeaderMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    for (const syn of SYNONYMS[field]) {
      const idx = headers.findIndex((h, i) => !used.has(i) && normHeader(h) === syn);
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
        break;
      }
    }
  }
  const unmapped = headers.filter((h, i) => !used.has(i) && h.trim() !== "");
  return { mapping, unmapped };
}

function hasNameColumn(m: HeaderMapping): boolean {
  return m.name !== undefined || (m.first_name !== undefined && m.last_name !== undefined) || m.first_name !== undefined;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function ymd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Turn a dated cell into an ISO date. Accepts ISO (`2026-07-12`, with an
 * optional time suffix), `12 Jul 2026` / `12 July 2026` (LinkedIn's
 * "Connected On"), `Jul 12, 2026`, `2026/07/12`, and US `7/12/2026`.
 * Returns null for anything else — unlike `parseDueDate` this needs a year.
 */
export function parseImportDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4})$/i);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mo < 0 ? null : ymd(+m[3], mo + 1, +m[1]);
  }
  m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mo < 0 ? null : ymd(+m[3], mo + 1, +m[2]);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return ymd(+m[3], +m[1], +m[2]);
  return null;
}

// ---------------------------------------------------------------------------
// Rows → people
// ---------------------------------------------------------------------------

export interface MappedPerson {
  /** Source line of the record (1-based). */
  line: number;
  name: string;
  slug: string;
  email: string | null;
  linkedin: string | null;
  role_title: string | null;
  company: string | null;
  location: string | null;
  phone: string | null;
  tags: string | null;
  notes: string | null;
  status_key: string;
  cadence_days: number | null;
  last_touch: string | null;
  /** Free text that did not parse as a date; stored as last_touch_note. */
  last_touch_note: string | null;
}

export interface RowError {
  row: number;
  message: string;
}

const STATUS_BY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS).flatMap(([key, v]) => [
    [key, key],
    [normHeader(key), key],
    [normHeader(v.label), key],
  ])
);

function cell(fields: string[], idx: number | undefined): string | null {
  if (idx === undefined) return null;
  const v = (fields[idx] ?? "").trim();
  return v || null;
}

/** Turn one CSV record into a person, or an error. */
export function mapRecord(rec: CsvRecord, mapping: HeaderMapping): MappedPerson | RowError {
  const f = rec.fields;
  const name =
    cell(f, mapping.name) ??
    [cell(f, mapping.first_name), cell(f, mapping.last_name)].filter(Boolean).join(" ").trim();
  if (!name) return { row: rec.line, message: "missing name" };
  const slug = slugify(name);
  if (!slug) return { row: rec.line, message: `the name "${name}" is only punctuation` };

  const statusRaw = cell(f, mapping.status);
  const status_key = statusRaw ? STATUS_BY_LABEL[normHeader(statusRaw)] : "new";
  if (!status_key) {
    return {
      row: rec.line,
      message: `unknown status "${statusRaw}" (use one of ${Object.values(STATUS).map((s) => s.label).join(", ")})`,
    };
  }

  const cadenceRaw = cell(f, mapping.cadence_days);
  let cadence_days: number | null = DEFAULT_CADENCE[status_key] ?? null;
  if (cadenceRaw) {
    const n = Number(cadenceRaw.replace(/\s*(days?|d)$/i, ""));
    if (!Number.isInteger(n) || n <= 0) return { row: rec.line, message: `cadence "${cadenceRaw}" is not a positive whole number of days` };
    cadence_days = n;
  }

  const touchRaw = cell(f, mapping.last_touch);
  const last_touch = touchRaw ? parseImportDate(touchRaw) : null;

  const tagsRaw = cell(f, mapping.tags);
  const tags = tagsRaw
    ? [...new Set(tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))].join(",") || null
    : null;

  return {
    line: rec.line,
    name,
    slug,
    email: cell(f, mapping.email),
    linkedin: cell(f, mapping.linkedin),
    role_title: cell(f, mapping.role_title),
    company: cell(f, mapping.company),
    location: cell(f, mapping.location),
    phone: cell(f, mapping.phone),
    tags,
    notes: cell(f, mapping.notes),
    status_key,
    cadence_days,
    last_touch,
    last_touch_note: touchRaw && !last_touch ? touchRaw : null,
  };
}

export interface ParsedCsv {
  /** The header row as found in the file. */
  headers: string[];
  mapping: HeaderMapping;
  unmapped: string[];
  people: MappedPerson[];
  errors: RowError[];
  /** Number of data records (rows after the header). */
  rowCount: number;
}

/**
 * Parse CSV text and map every record to a person. The header row is the
 * first record (within the first 20) that yields a name column, so a
 * preamble such as LinkedIn's "Notes:" block is skipped.
 */
export function parseImportCsv(text: string): ParsedCsv {
  const records = parseCsvRecords(text);
  let headerIdx = -1;
  let found: { mapping: HeaderMapping; unmapped: string[] } | null = null;
  for (let i = 0; i < Math.min(records.length, 20); i++) {
    const m = mapHeaders(records[i].fields);
    if (hasNameColumn(m.mapping)) {
      headerIdx = i;
      found = m;
      break;
    }
  }
  if (headerIdx < 0 || !found) {
    throw new Error(
      'No header row with a name column found. The CSV needs a "Name" column, or "First Name" and "Last Name".'
    );
  }
  const headers = records[headerIdx].fields;
  const people: MappedPerson[] = [];
  const errors: RowError[] = [];
  const data = records.slice(headerIdx + 1);
  for (const rec of data) {
    const r = mapRecord(rec, found.mapping);
    if ("message" in r) errors.push(r);
    else people.push(r);
  }
  return { headers, mapping: found.mapping, unmapped: found.unmapped, people, errors, rowCount: data.length };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Fill blank contact fields on people that already exist instead of skipping them. */
  update?: boolean;
  /** Run everything, then roll back. */
  dryRun?: boolean;
}

export interface ImportReport {
  /** Data rows in the file (after the header). */
  rows: number;
  created: number;
  /** Existing people whose blank fields were filled (only with `update`). */
  updated: number;
  /** Distinct existing companies that got at least one person linked. */
  linkedCompanies: number;
  /** Distinct companies created because no slug matched. */
  createdCompanies: number;
  skippedExisting: string[];
  errors: RowError[];
  dryRun: boolean;
}

/** Contact fields that `update` may fill when blank. Narrative sections are never touched. */
const FILLABLE = ["email", "linkedin", "role_title", "location", "phone"] as const;

class DryRunRollback extends Error {
  report: ImportReport;
  constructor(report: ImportReport) {
    super("__dry_run__");
    this.report = report;
  }
}

/**
 * Import mapped people into the database in one transaction. Existing slugs
 * are skipped (or, with `update`, have blank contact fields filled). Companies
 * are linked by slug and created when missing.
 */
export function importPeople(db: Database.Database, parsed: ParsedCsv, opts: ImportOptions = {}): ImportReport {
  const report: ImportReport = {
    rows: parsed.rowCount,
    created: 0,
    updated: 0,
    linkedCompanies: 0,
    createdCompanies: 0,
    skippedExisting: [],
    errors: [...parsed.errors],
    dryRun: !!opts.dryRun,
  };

  const findPerson = db.prepare(
    `SELECT id, name, email, linkedin, role_title, company_id, location, phone FROM people WHERE slug = ?`
  );
  const findCompany = db.prepare(`SELECT id FROM companies WHERE slug = ?`);
  const insertCompany = db.prepare(`INSERT INTO companies (slug, name, status_key) VALUES (?, ?, 'new')`);
  const insertPerson = db.prepare(
    `INSERT INTO people (slug, name, status_key, role_title, company_id, location, email, phone, linkedin,
                         notes, last_touch, last_touch_note, cadence_days, tags)
     VALUES (@slug, @name, @status_key, @role_title, @company_id, @location, @email, @phone, @linkedin,
             @notes, @last_touch, @last_touch_note, @cadence_days, @tags)`
  );

  const linked = new Set<number>();
  const created = new Set<number>();
  const companyId = (name: string | null): number | null => {
    if (!name) return null;
    const slug = slugify(name);
    if (!slug) return null;
    const row = findCompany.get(slug) as { id: number } | undefined;
    if (row) {
      if (!created.has(row.id)) linked.add(row.id);
      return row.id;
    }
    const id = Number(insertCompany.run(slug, name).lastInsertRowid);
    created.add(id);
    return id;
  };

  const run = db.transaction(() => {
    for (const p of parsed.people) {
      try {
        const existing = findPerson.get(p.slug) as
          | { id: number; name: string; email: string | null; linkedin: string | null; role_title: string | null; company_id: number | null; location: string | null; phone: string | null }
          | undefined;
        if (existing) {
          if (!opts.update) {
            report.skippedExisting.push(p.name);
            continue;
          }
          const sets: string[] = [];
          const params: Record<string, string | number | null> = { id: existing.id };
          for (const f of FILLABLE) {
            if (!existing[f] && p[f]) {
              sets.push(`${f} = @${f}`);
              params[f] = p[f];
            }
          }
          if (!existing.company_id && p.company) {
            const cid = companyId(p.company);
            if (cid) {
              sets.push(`company_id = @company_id`);
              params.company_id = cid;
            }
          }
          if (!sets.length) {
            report.skippedExisting.push(p.name);
            continue;
          }
          db.prepare(`UPDATE people SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = @id`).run(params);
          report.updated++;
          continue;
        }
        insertPerson.run({
          slug: p.slug,
          name: p.name,
          status_key: p.status_key,
          role_title: p.role_title,
          company_id: companyId(p.company),
          location: p.location,
          email: p.email,
          phone: p.phone,
          linkedin: p.linkedin,
          notes: p.notes,
          last_touch: p.last_touch,
          last_touch_note: p.last_touch_note,
          cadence_days: p.cadence_days,
          tags: p.tags,
        });
        report.created++;
      } catch (err) {
        report.errors.push({ row: p.line, message: err instanceof Error ? err.message : String(err) });
      }
    }
    report.linkedCompanies = linked.size;
    report.createdCompanies = created.size;
    report.errors.sort((a, b) => a.row - b.row);
    if (opts.dryRun) throw new DryRunRollback(report);
  });

  try {
    run();
  } catch (err) {
    if (err instanceof DryRunRollback) return err.report;
    throw err;
  }
  return report;
}

/** Convenience: parse text and import in one go. */
export function importCsvText(db: Database.Database, text: string, opts: ImportOptions = {}): ImportReport {
  return importPeople(db, parseImportCsv(text), opts);
}
