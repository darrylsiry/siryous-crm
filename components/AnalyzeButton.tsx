"use client";

import { useFormStatus } from "react-dom";

export default function AnalyzeButton() {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Analyzing…" : "✨ Analyze"}
      </button>
      {pending ? (
        <span className="text-sm text-stone-500 animate-pulse">
          Starting — you'll see the model's progress live on the next page…
        </span>
      ) : null}
    </div>
  );
}
