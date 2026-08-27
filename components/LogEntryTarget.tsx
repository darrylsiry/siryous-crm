"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * "Log on <person>" header for one draft log entry. When the model's slug is
 * in the roster the entry is pre-ticked and the select defaults to it. When
 * it isn't (a hallucinated or misspelled slug), the entry starts unticked and
 * disabled with a note, and the select lets you re-target it to a real
 * contact — which enables and ticks it. Field names are what confirmLog
 * reads: entry_<i> (checkbox) and entry_slug_<i> (target).
 */
export default function LogEntryTarget({
  index,
  modelSlug,
  valid,
  people,
}: {
  index: number;
  modelSlug: string;
  valid: boolean;
  people: { slug: string; name: string }[];
}) {
  const [slug, setSlug] = useState(valid ? modelSlug : "");
  const [checked, setChecked] = useState(valid);
  const untargeted = slug === "";

  return (
    <div className="space-y-1">
      <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          name={`entry_${index}`}
          checked={checked}
          disabled={untargeted}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>Log on</span>
        <select
          name={`entry_slug_${index}`}
          value={slug}
          onChange={(e) => {
            const v = e.target.value;
            setSlug(v);
            setChecked(v !== "");
          }}
          className={`rounded-lg border px-2 py-1 text-sm font-medium ${untargeted ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-300 bg-white"}`}
        >
          {!valid ? <option value="">{modelSlug} (not in your CRM)</option> : null}
          {people.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {untargeted ? (
        <p className="text-xs text-amber-800">
          <span className="font-semibold">{modelSlug}</span> is not in your CRM — add them via{" "}
          <Link href="/intake" className="underline">Intake</Link> first, or pick the right contact above. Until then this entry is skipped.
        </p>
      ) : !valid ? (
        <p className="text-xs text-stone-500">The AI wrote “{modelSlug}”, which isn&apos;t in your CRM — you picked this person instead.</p>
      ) : null}
    </div>
  );
}
