import { mapData } from "@/lib/queries";
import { STATUS } from "@/lib/db";
import NetworkMap from "@/components/NetworkMap";

export const dynamic = "force-dynamic";

export const metadata = { title: "Map" };

export default function MapPage() {
  const data = mapData();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Map</h1>
        <p className="mt-1 text-sm text-stone-600">
          Your relationships: circles are people (coloured by status, and named in the chips below), squares are companies.
          Hover over a node, or tap it, to see its network; solid violet lines are intros made, dashed are intros still owed.
          Click a node (on a touch screen, tap it again) to open its profile.
        </p>
      </header>
      {data.people.length || data.companies.length ? (
        <NetworkMap
          data={data}
          statuses={Object.entries(STATUS).map(([key, s]) => ({ key, label: s.label, dot: s.dot, rank: s.rank }))}
        />
      ) : (
        <p className="rounded-xl border border-stone-200 bg-white p-6 text-sm italic text-stone-500">
          Nothing to map yet — the graph draws people, their companies, and intros between them.
          Add your first person on the People page, or paste a LinkedIn profile into Intake.
        </p>
      )}
    </div>
  );
}
