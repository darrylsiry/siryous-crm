"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { addActionItem, type FormResult } from "@/lib/actions";
import { useToast } from "@/components/Toaster";
import DueField from "@/components/DueField";
import { PersonSelect } from "@/components/PeoplePicker";
import SearchSelect, { type SearchOption } from "@/components/SearchSelect";

/** The group whose to-dos need a date (lib/actions.ts refuses one without). */
const DATED_BUCKET = "this_week";

/**
 * Add a to-do. On the Actions page it picks a person and company; on a
 * profile they're fixed by `personId` / `companyId`. The form clears and a
 * toast confirms once it's saved; a refusal keeps what was typed.
 */
export default function AddActionForm({
  buckets,
  companies,
  personId,
  companyId,
  onAdded,
}: {
  buckets: { key: string; label: string; icon: string }[];
  companies?: SearchOption[];
  personId?: number;
  companyId?: number;
  onAdded?: () => void;
}) {
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  const [bucket, setBucket] = useState(buckets.some((b) => b.key === DATED_BUCKET) ? DATED_BUCKET : (buckets[0]?.key ?? ""));
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState<FormResult, FormData>(addActionItem, null);
  useEffect(() => {
    if (state?.ok) {
      toast(`✓ ${state.message}`);
      setFormKey((k) => k + 1); // fresh, empty fields
      onAdded?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const label = "text-xs font-medium text-stone-600";
  const input = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";
  return (
    <form
      key={formKey}
      ref={form}
      // Dispatched by hand so React doesn't clear the fields when the save is refused.
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      {personId ? <input type="hidden" name="person_id" value={personId} /> : null}
      {companyId ? <input type="hidden" name="company_id" value={companyId} /> : null}
      <label className={`${label} sm:col-span-2`}>
        What needs doing *
        <input name="title" required className={input} />
      </label>
      <label className={label}>
        Group
        <select name="bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} className={input}>
          {buckets.map((b) => (
            <option key={b.key} value={b.key}>
              {b.icon} {b.label}
            </option>
          ))}
        </select>
      </label>
      <div className={label}>
        Due{bucket === DATED_BUCKET ? " *" : ""}
        <DueField required={bucket === DATED_BUCKET} />
      </div>
      {personId || companyId ? null : (
        <>
          <label className={label}>
            Person
            <PersonSelect className="mt-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <label className={label}>
            Company
            <SearchSelect
              name="company_id"
              options={companies ?? []}
              emptyLabel="None"
              className="mt-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
              ariaLabel="Company"
            />
          </label>
        </>
      )}
      {state && !state.ok ? (
        <p role="alert" className="text-sm font-medium text-red-700 sm:col-span-2">
          Not added: {state.message}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}
