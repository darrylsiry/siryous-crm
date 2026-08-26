import Markdown from "./Markdown";
import ClosingDetails from "@/components/ClosingDetails";
import { updateSection } from "@/lib/actions";

export default function EditableSection({
  title,
  subtitle,
  entity,
  id,
  column,
  value,
}: {
  title: string;
  subtitle?: string;
  entity: "person" | "company";
  id: number;
  column: string;
  value: string | null;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-xs text-stone-400 mt-0.5">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {value ? (
        <Markdown>{value}</Markdown>
      ) : (
        <p className="text-sm italic text-stone-400">Nothing here yet.</p>
      )}
      <ClosingDetails className="mt-3 group">
        <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-800 select-none list-none">
          ✎ Edit
        </summary>
        <form action={updateSection} className="mt-2">
          <input type="hidden" name="entity" value={entity} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="column" value={column} />
          <textarea
            name="value"
            defaultValue={value ?? ""}
            rows={Math.min(18, Math.max(6, (value ?? "").split("\n").length + 2))}
            className="w-full rounded-lg border border-stone-300 p-3 font-mono text-xs leading-relaxed focus:border-indigo-400 focus:outline-none"
            placeholder="Markdown supported…"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Save
            </button>
          </div>
        </form>
      </ClosingDetails>
    </section>
  );
}
