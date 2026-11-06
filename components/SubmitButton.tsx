"use client";

import { useFormStatus } from "react-dom";

/**
 * Minimal submit button that disables itself while the enclosing form's server
 * action is pending (double-submit guard). Forwards className/children/title so
 * it can stand in for any styled <button type="submit">, including glyph-only ones.
 */
export default function SubmitButton({
  children,
  pendingChildren,
  className,
  title,
  name,
  value,
}: {
  children: React.ReactNode;
  /** What to show while pending; defaults to the normal children. */
  pendingChildren?: React.ReactNode;
  className?: string;
  title?: string;
  /** Sent with the form when this button submits it (e.g. decision=apply). */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending || undefined}
      title={title}
      className={`${className ?? ""} disabled:cursor-progress disabled:opacity-60`}
    >
      {pending && pendingChildren !== undefined ? pendingChildren : children}
    </button>
  );
}
