"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "./db";
import { IMPORT_FIELDS, importPeople, parseImportCsv, type ImportField, type ImportReport, type MappedPerson } from "./importCsv";

/** State returned to the /import form after each step. */
export type ImportState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "preview";
      fileName: string;
      /** The CSV text, carried back to the import step in a hidden field. */
      csv: string;
      update: boolean;
      columns: { header: string; field: ImportField | null }[];
      sample: MappedPerson[];
      report: ImportReport;
    }
  | { kind: "done"; fileName: string; update: boolean; report: ImportReport };

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * One action, two steps: `mode=preview` reads the uploaded file, maps it and
 * runs a dry run (nothing written); `mode=import` re-reads the CSV text from
 * the hidden field and imports it for real.
 */
export async function importCsvAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const mode = String(formData.get("mode") ?? "preview");
  const update = formData.get("update") === "1";
  let csv: string;
  let fileName: string;
  if (mode === "preview") {
    const file = formData.get("file");
    if (!(file instanceof File) || !file.size) return { kind: "error", message: "Choose a CSV file first." };
    if (file.size > MAX_BYTES) return { kind: "error", message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.` };
    csv = await file.text();
    fileName = file.name;
  } else {
    csv = String(formData.get("csv") ?? "");
    fileName = String(formData.get("file_name") ?? "upload.csv");
    if (!csv.trim()) return { kind: "error", message: "Nothing to import — start again by choosing a file." };
  }

  let parsed;
  try {
    parsed = parseImportCsv(csv);
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }

  if (mode === "preview") {
    const report = importPeople(getDb(), parsed, { update, dryRun: true });
    const fieldFor = new Map<number, ImportField>();
    for (const f of IMPORT_FIELDS) {
      const idx = parsed.mapping[f];
      if (idx !== undefined) fieldFor.set(idx, f);
    }
    return {
      kind: "preview",
      fileName,
      csv,
      update,
      columns: parsed.headers.map((header, i) => ({ header, field: fieldFor.get(i) ?? null })),
      sample: parsed.people.slice(0, 10),
      report,
    };
  }

  const report = importPeople(getDb(), parsed, { update });
  revalidatePath("/", "layout");
  return { kind: "done", fileName, update, report };
}
