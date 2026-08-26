"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 font-mono text-xs text-red-800 whitespace-pre-wrap">{error.message}</p>
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
