"use client";

import Link from "next/link";
import { useState } from "react";
import SearchSelect from "@/components/SearchSelect";

/**
 * One draft log entry: "Log on <person>", the entry itself (`children`), then
 * the next step it proposes beside the one it would replace. When the model's
 * slug is in the roster the entry is pre-ticked and the select defaults to it.
 * When it isn't (a hallucinated or misspelled slug), the entry starts unticked
 * and disabled with a note, and the select lets you re-target it to a real
 * contact — which enables and ticks it. A company target has no next step.
 * Field names are what confirmLog reads: entry_<i>, entry_slug_<i>,
 * entry_next_<i>, entry_keep_next_<i>, entry_todo_<i>, entry_todo_due_<i>.
 */
export default function LogEntryTarget({
  index,
  modelSlug,
  valid,
  people,
  companies = [],
  aiNext,
  intakeHref,
  children,
}: {
  index: number;
  modelSlug: string;
  valid: boolean;
  /** `next`: the person's current next step, shown beside the AI's. */
  people: { slug: string; name: string; next: string | null }[];
  /** Offered as "company:<slug>" targets — an entry on the company with no specific person. */
  companies?: { slug: string; name: string }[];
  aiNext: string | null;
  /** Intake, carrying this draft's text, for someone not in the CRM. */
  intakeHref: string;
  children: React.ReactNode;
}) {
  const [slug, setSlug] = useState(valid ? modelSlug : "");
  const [checked, setChecked] = useState(valid);
  const [keep, setKeep] = useState(false);
  const [todo, setTodo] = useState(false);
  const untargeted = slug === "";
  const isCompany = slug.startsWith("company:");
  const current = people.find((p) => p.slug === slug)?.next ?? null;

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
        <span className="min-w-56 flex-1 font-medium">
          <SearchSelect
            name={`entry_slug_${index}`}
            value={slug}
            onChange={(v) => {
              setSlug(v);
              setChecked(v !== "");
            }}
            options={[
              ...people.map((p) => ({ value: p.slug, label: p.name })),
              ...companies.map((c) => ({ value: `company:${c.slug}`, label: c.name, group: "A company (no specific person)" })),
            ]}
            allowEmpty={!valid}
            emptyLabel={`${modelSlug} (not in your CRM)`}
            className={`rounded-lg border px-2 py-1 text-sm ${untargeted ? "border-amber-300 bg-amber-50 text-amber-900" : "border-stone-300 bg-white"}`}
          />
        </span>
      </label>
      {untargeted ? (
        <p className="text-xs text-amber-800">
          <span className="font-semibold">{modelSlug}</span> is not in your CRM —{" "}
          <Link href={intakeHref} className="font-medium underline">
            create a profile from these notes
          </Link>{" "}
          first, or pick the right contact above. Until then this entry is skipped.
        </p>
      ) : !valid ? (
        <p className="text-xs text-stone-600">The AI wrote “{modelSlug}”, which isn&apos;t in your CRM — you picked this person instead.</p>
      ) : null}
      {children}
      {!isCompany && !untargeted && (aiNext || current) ? (
        <div className="mt-3 rounded-lg border border-stone-200 px-3 py-2 text-sm">
          <p className="text-xs font-medium text-stone-600">Next step</p>
          <p className="mt-1 text-xs text-stone-600">
            <span className="font-medium">Now:</span> {current ?? <span className="italic">none set</span>}
          </p>
          <label className="mt-1 block text-xs text-stone-600">
            <span className="font-medium">New{aiNext ? " (from the AI)" : ""}:</span>
            <input
              name={`entry_next_${index}`}
              defaultValue={aiNext ?? ""}
              disabled={keep}
              placeholder="Leave blank to keep the current one"
              className="mt-0.5 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm disabled:bg-stone-100 disabled:text-stone-500"
            />
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600">
            {current ? (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name={`entry_keep_next_${index}`} checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                Keep the current one
              </label>
            ) : null}
            {!keep ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" name={`entry_todo_${index}`} checked={todo} onChange={(e) => setTodo(e.target.checked)} />
                  Also add it to my to-dos, due
                </label>
                <input
                  type="date"
                  name={`entry_todo_due_${index}`}
                  aria-label="To-do due date"
                  onChange={(e) => e.target.value && setTodo(true)}
                  className="rounded border border-stone-300 px-1.5 py-0.5"
                />
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
