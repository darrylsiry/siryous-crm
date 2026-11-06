"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** "Check again": re-render the page so a status notice reflects what changed (Ollama opened, a model pulled). */
export default function RefreshButton({ label = "Check again" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="rounded-md border border-amber-400 bg-white px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
    >
      {pending ? "Checking…" : label}
    </button>
  );
}
