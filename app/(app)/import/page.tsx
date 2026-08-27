import Link from "next/link";
import ImportForm from "./ImportForm";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">⇪ Import</h1>
        <p className="mt-1 text-sm text-stone-500">
          Add many people at once from a spreadsheet (a CSV file). A LinkedIn <code>Connections.csv</code> export works as-is (on LinkedIn:
          Settings → Data privacy → Get a copy of your data → Connections); any spreadsheet saved as CSV with a header row does too.
          Columns are matched by name — name (or first
          + last name), email, LinkedIn/URL, role/title/position, company, location, phone, tags, notes, status, cadence, last touch
          / connected on. Companies are linked when a name matches one you already have and created otherwise. People who already
          exist are never overwritten. You get a preview before anything is written.
        </p>
      </header>

      <ImportForm />

      <p className="text-xs text-stone-400">
        Nothing leaves your computer — the file is read on this Mac and saved straight into the CRM. Files over 1 MB: split
        the spreadsheet in two and import each half (developers: <code>npm run import-csv</code>). For one person at a time, use{" "}
        <Link href="/intake" className="underline">Intake</Link> (which also writes the profile) or the{" "}
        <Link href="/people" className="underline">People</Link> page.
      </p>
    </div>
  );
}
