"use client";

import { useFormStatus } from "react-dom";

const DEFAULT_CLASS =
  "rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60";

/**
 * Submit button that disables itself while the enclosing form's server action
 * is pending. `className` overrides the default large indigo style for the
 * smaller inline forms.
 */
export default function PendingButton({
  label,
  pendingLabel,
  pendingNote,
  className,
}: {
  label: string;
  pendingLabel: string;
  pendingNote?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className={className ?? DEFAULT_CLASS}
      >
        {pending ? pendingLabel : label}
      </button>
      {pending && pendingNote ? (
        <span className="text-sm text-stone-500 animate-pulse">{pendingNote}</span>
      ) : null}
    </div>
  );
}
