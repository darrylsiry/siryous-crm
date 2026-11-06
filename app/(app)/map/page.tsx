import { mapData } from "@/lib/queries";
import { STATUS } from "@/lib/db";
import NetworkMap from "@/components/NetworkMap";

export const dynamic = "force-dynamic";

export default function MapPage() {
  const data = mapData();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Relationship Map</h1>
        <p className="mt-1 text-sm text-stone-500">
          Circles are people (colored by status), squares are companies. Hover to
          isolate a node's network; solid violet lines are made intros, dashed are
          intros still owed. Click any node to open its profile.
        </p>
      </header>
      <div className="flex flex-wrap gap-3 text-xs text-stone-500">
        {Object.entries(STATUS).map(([key, s]) => (
          <span key={key} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.dot }}
            />
            {s.label}
          </span>
        ))}
      </div>
      {data.people.length || data.companies.length ? (
        <NetworkMap data={data} statusFill={Object.fromEntries(Object.entries(STATUS).map(([k, s]) => [k, s.dot]))} />
      ) : (
        <p className="rounded-xl border border-stone-200 bg-white p-6 text-sm italic text-stone-400">
          Nothing to map yet — the graph draws people, their companies, and intros between them.
          Add your first person on the People page, or paste a LinkedIn profile into Intake.
        </p>
      )}
    </div>
  );
}
