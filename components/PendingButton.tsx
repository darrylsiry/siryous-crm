"use client";

import { useFormStatus } from "react-dom";

export default function PendingButton({
  label,
  pendingLabel,
  pendingNote,
}: {
  label: string;
  pendingLabel: string;
  pendingNote: string;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? pendingLabel : label}
      </button>
      {pending ? (
        <span className="text-sm text-stone-500 animate-pulse">{pendingNote}</span>
      ) : null}
    </div>
  );
}
