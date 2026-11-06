"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-stone-700">
        This page couldn&apos;t load. Your saved data is safe. Try again, or go back to the Dashboard.
      </p>
      <details className="text-xs text-stone-600">
        <summary className="cursor-pointer">If it keeps happening: details to include when asking for help</summary>
        <p className="mt-2 whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 font-mono">
          {error.message}
          {error.digest ? `\n(reference ${error.digest})` : ""}
        </p>
      </details>
      <div className="flex gap-3">
        <button onClick={reset} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
