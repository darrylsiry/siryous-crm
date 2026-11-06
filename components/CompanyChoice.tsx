"use client";

import { useMemo, useState } from "react";
import SearchSelect from "@/components/SearchSelect";

/** A company name without its legal suffix and punctuation, for spotting "Acme" vs "Acme, Inc.". */
function core(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|group|holdings)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Intake's company step. The three choices follow what the owner does:
 * picking a company selects "Link to existing", typing a new name selects
 * "Create new company" (and its fields show only then), and a new name that
 * matches an existing company offers to link to that one instead. Field names
 * are what confirmIntake reads: company_mode, existing_company_id,
 * company_name, company_industry, company_website, company_hq, company_context.
 */
export default function CompanyChoice({
  companies,
  existingId,
  suggested,
}: {
  companies: { id: number; name: string }[];
  existingId: number | null;
  suggested: { name: string; industry: string | null; website: string | null; hq: string | null; business_context_md: string | null } | null;
}) {
  const [mode, setMode] = useState<"existing" | "new" | "none">(existingId ? "existing" : suggested ? "new" : "none");
  const [picked, setPicked] = useState(existingId ? String(existingId) : "");
  const [newName, setNewName] = useState(suggested?.name ?? "");
  const nearMatch = useMemo(() => {
    const c = core(newName);
    if (mode !== "new" || c.length < 2) return null;
    return companies.find((x) => core(x.name) === c) ?? null;
  }, [companies, newName, mode]);
  const input = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";
  const label = "block text-xs font-medium text-stone-600";
  return (
    <div className="space-y-2 text-sm">
      <input type="hidden" name="company_mode" value={mode} />
      <label className="flex flex-wrap items-center gap-2">
        <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} />
        Link to existing:
        <span className="min-w-56 flex-1">
          <SearchSelect
            name="existing_company_id"
            value={picked}
            onChange={(v) => {
              setPicked(v);
              setMode(v ? "existing" : mode === "existing" ? "none" : mode);
            }}
            options={companies.map((c) => ({ value: String(c.id), label: c.name }))}
            emptyLabel="Choose a company"
            ariaLabel="Existing company"
            className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
          />
        </span>
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
        Create a new company
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" checked={mode === "none"} onChange={() => setMode("none")} />
        No company
      </label>
      {mode === "new" ? (
        <div className="grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2">
          <label className={label}>
            Company name
            <input name="company_name" value={newName} onChange={(e) => setNewName(e.target.value)} required className={input} />
          </label>
          <label className={label}>
            Industry
            <input name="company_industry" defaultValue={suggested?.industry ?? ""} className={input} />
          </label>
          <label className={label}>
            Website
            <input name="company_website" defaultValue={suggested?.website ?? ""} className={input} />
          </label>
          <label className={label}>
            HQ
            <input name="company_hq" defaultValue={suggested?.hq ?? ""} className={input} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Company business context
            <textarea name="company_context" rows={4} defaultValue={suggested?.business_context_md ?? ""} className={input} />
          </label>
          {nearMatch ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2">
              <b>{nearMatch.name}</b> already exists.{" "}
              <button
                type="button"
                onClick={() => {
                  setPicked(String(nearMatch.id));
                  setMode("existing");
                }}
                className="font-semibold underline"
              >
                Link to it instead
              </button>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-stone-500">
          {mode === "existing" ? (picked ? "The person is linked to this company." : "Choose the company above.") : "The person is saved without a company."}
        </p>
      )}
    </div>
  );
}
