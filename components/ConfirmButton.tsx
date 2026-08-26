"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for destructive form actions: asks for confirmation first and
 * disables itself while the action runs. Use inside a <form action={…}>.
 */
export default function ConfirmButton({
  label,
  confirm: message,
  className,
}: {
  label: string;
  confirm: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      className={className ?? "rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"}
    >
      {pending ? "…" : label}
    </button>
  );
}
