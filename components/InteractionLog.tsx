import type { Interaction } from "@/lib/types";
import { deleteInteraction } from "@/lib/actions";
import ConfirmButton from "./ConfirmButton";
import Markdown from "./Markdown";

export default function InteractionLog({
  interactions,
}: {
  interactions: (Interaction & { person_name?: string | null; person_slug?: string | null })[];
}) {
  if (!interactions.length) {
    return <p className="text-sm italic text-stone-400">No interactions logged yet.</p>;
  }
  return (
    <ol className="relative space-y-4 border-l border-stone-200 pl-5">
      {interactions.map((i) => (
        <li key={i.id} className="relative">
          <span className="absolute -left-[1.62rem] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo-300 ring-4 ring-white" />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold text-stone-900">{i.date}</span>
            {i.channel ? (
              <span className="text-stone-500">— {i.channel}</span>
            ) : null}
            {i.person_name ? (
              <span className="text-xs text-stone-400">
                (w/ {i.person_name})
              </span>
            ) : null}
            <form action={deleteInteraction.bind(null, i.id)} className="ml-auto">
              <ConfirmButton
                label="×"
                confirm={`Delete the ${i.date} interaction? This can't be undone.`}
                className="rounded px-1.5 text-base leading-none text-stone-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
              />
            </form>
          </div>
          <div className="mt-0.5">
            <Markdown>{i.summary}</Markdown>
          </div>
        </li>
      ))}
    </ol>
  );
}
