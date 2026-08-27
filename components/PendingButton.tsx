"use client";

import { useFormStatus } from "react-dom";

const DEFAULT_CLASS =
  "rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60";

/**
 * Submit button that disables itself while the enclosing form's server action
 * is pending. `className` overrides the default large indigo style for the
 * smaller inline forms. `disabled` (with an optional `disabledLabel`) is for
 * actions that can't succeed right now — e.g. AI runs while Ollama is down.
 */
export default function PendingButton({
  label,
  pendingLabel,
  pendingNote,
  className,
  disabled = false,
  disabledLabel = "AI is off — see above",
}: {
  label: string;
  pendingLabel: string;
  pendingNote?: string;
  className?: string;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending || disabled}
        aria-busy={pending || undefined}
        title={disabled ? "The AI isn't available right now — see the notice above." : undefined}
        className={`${className ?? DEFAULT_CLASS} disabled:cursor-not-allowed`}
      >
        {disabled ? disabledLabel : pending ? pendingLabel : label}
      </button>
      {pending && pendingNote ? (
        <span className="text-sm text-stone-500 animate-pulse">{pendingNote}</span>
      ) : null}
    </div>
  );
}
