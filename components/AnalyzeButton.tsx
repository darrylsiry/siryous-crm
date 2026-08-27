"use client";

import { useFormStatus } from "react-dom";

/**
 * Intake's submit button. `disabled` (the AI can't run — see AiStatusBanner)
 * relabels it so a person isn't offered a run that is guaranteed to fail.
 */
export default function AnalyzeButton({ disabled = false }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending || disabled}
        title={disabled ? "The AI isn't available right now — see the notice above." : undefined}
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disabled ? "AI is off — see above" : pending ? "Analyzing…" : "✨ Analyze"}
      </button>
      {pending ? (
        <span className="text-sm text-stone-500 animate-pulse">
          Starting — you'll see the AI's progress live on the next page…
        </span>
      ) : null}
    </div>
  );
}
