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
              style={{
                backgroundColor:
                  {
                    new: "#10b981",
                    exploring: "#0ea5e9",
                    active: "#f97316",
                    on_hold: "#94a3b8",
                    client: "#8b5cf6",
                    won: "#22c55e",
                    lost: "#ef4444",
                    dormant: "#a8a29e",
                  }[key] ?? "#a8a29e",
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <NetworkMap data={data} />
    </div>
  );
}
