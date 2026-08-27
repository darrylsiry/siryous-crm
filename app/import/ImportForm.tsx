"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { importCsvAction, type ImportState } from "@/lib/importActions";
import type { ImportReport } from "@/lib/importCsv";

const initial: ImportState = { kind: "idle" };

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  const color =
    tone === "good" ? "text-green-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-700" : "text-stone-800";
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[0.7rem] uppercase tracking-wide text-stone-500">{label}</div>
    </div>
  );
}

function ReportView({ report, update, future }: { report: ImportReport; update: boolean; future: boolean }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="rows" value={report.rows} />
        <Stat label={future ? "to create" : "created"} value={report.created} tone="good" />
        {update ? <Stat label={future ? "to update" : "updated"} value={report.updated} tone="good" /> : null}
        <Stat label="companies linked" value={report.linkedCompanies} />
        <Stat label={future ? "companies to create" : "companies created"} value={report.createdCompanies} />
        <Stat label="skipped (exist)" value={report.skippedExisting.length} tone={report.skippedExisting.length ? "warn" : undefined} />
        <Stat label="errors" value={report.errors.length} tone={report.errors.length ? "bad" : undefined} />
      </div>
      {report.skippedExisting.length ? (
        <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">
            {report.skippedExisting.length} already in the CRM — {future ? "will be" : "were"} left untouched
            {update ? " (nothing blank to fill)" : ""}
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {report.skippedExisting.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {report.errors.length ? (
        <details open className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <summary className="cursor-pointer font-medium">{report.errors.length} row{report.errors.length === 1 ? "" : "s"} skipped with errors</summary>
          <ul className="mt-2 list-disc pl-5">
            {report.errors.map((e, i) => (
              <li key={i}>
                line {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export default function ImportForm() {
  const [state, action] = useActionState(importCsvAction, initial);

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <input type="hidden" name="mode" value="preview" />
        <label className="block text-xs font-medium text-stone-600">
          CSV file
          <input
            type="file"
            name="file"
            accept=".csv,text/csv,text/plain"
            required
            className="mt-1 block w-full text-sm text-stone-700 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-stone-700 hover:file:bg-stone-200"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" name="update" value="1" defaultChecked={state.kind === "preview" || state.kind === "done" ? state.update : false} />
          Update existing people — fill in blank email / LinkedIn / role / company / location / phone. Never overwrites a filled field or any narrative section.
        </label>
        <SubmitButton label="Preview" pendingLabel="Reading…" />
      </form>

      {state.kind === "error" ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{state.message}</p>
      ) : null}

      {state.kind === "preview" ? (
        <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Preview — {state.fileName}</h2>
            <p className="mt-1 text-xs text-stone-500">Nothing has been written yet. This is what the import would do.</p>
          </div>

          <ReportView report={state.report} update={state.update} future />

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Columns</h3>
            <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {state.columns.map((c, i) => (
                <li
                  key={i}
                  className={`rounded-md px-2 py-0.5 ring-1 ${c.field ? "bg-indigo-50 text-indigo-800 ring-indigo-600/20" : "bg-stone-100 text-stone-500 ring-stone-400/20"}`}
                  title={c.field ? `→ ${c.field}` : "ignored"}
                >
                  {c.header || "(blank)"} {c.field ? <span className="text-indigo-500">→ {c.field}</span> : <span>· ignored</span>}
                </li>
              ))}
            </ul>
          </div>

          {state.sample.length ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">First {state.sample.length} rows as they would be saved</h3>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-stone-500">
                      <th className="py-1 pr-3 font-medium">Name</th>
                      <th className="py-1 pr-3 font-medium">Role</th>
                      <th className="py-1 pr-3 font-medium">Company</th>
                      <th className="py-1 pr-3 font-medium">Email</th>
                      <th className="py-1 pr-3 font-medium">Location</th>
                      <th className="py-1 pr-3 font-medium">Status</th>
                      <th className="py-1 pr-3 font-medium">Cadence</th>
                      <th className="py-1 pr-3 font-medium">Last touch</th>
                      <th className="py-1 pr-3 font-medium">Tags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {state.sample.map((p) => (
                      <tr key={p.line} className="align-top">
                        <td className="py-1 pr-3 font-medium text-stone-800">
                          {p.name}
                          <span className="block text-[0.65rem] font-normal text-stone-400">{p.slug}</span>
                        </td>
                        <td className="py-1 pr-3">{p.role_title ?? "—"}</td>
                        <td className="py-1 pr-3">{p.company ?? "—"}</td>
                        <td className="py-1 pr-3">{p.email ?? "—"}</td>
                        <td className="py-1 pr-3">{p.location ?? "—"}</td>
                        <td className="py-1 pr-3">{p.status_key}</td>
                        <td className="py-1 pr-3">{p.cadence_days ? `${p.cadence_days}d` : "—"}</td>
                        <td className="py-1 pr-3">{p.last_touch ?? (p.last_touch_note ? `(${p.last_touch_note})` : "—")}</td>
                        <td className="py-1 pr-3">{p.tags ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <form action={action} className="flex items-center gap-3 border-t border-stone-100 pt-4">
            <input type="hidden" name="mode" value="import" />
            <input type="hidden" name="csv" value={state.csv} />
            <input type="hidden" name="file_name" value={state.fileName} />
            {state.update ? <input type="hidden" name="update" value="1" /> : null}
            <SubmitButton
              label={`⇪ Import ${state.report.created} ${state.report.created === 1 ? "person" : "people"}${state.update && state.report.updated ? ` + update ${state.report.updated}` : ""}`}
              pendingLabel="Importing…"
            />
            <span className="text-xs text-stone-400">Runs in one transaction; rows with errors are skipped, the rest go in.</span>
          </form>
        </section>
      ) : null}

      {state.kind === "done" ? (
        <section className="space-y-4 rounded-xl border border-green-200 bg-white p-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-green-700">Imported — {state.fileName}</h2>
            <p className="mt-1 text-xs text-stone-500">
              Done. See them on the <Link href="/people" className="underline">People</Link> page; companies created here start as 🌱 New with no
              profile text — Intake or the profile pages can fill that in.
            </p>
          </div>
          <ReportView report={state.report} update={state.update} future={false} />
        </section>
      ) : null}
    </div>
  );
}
