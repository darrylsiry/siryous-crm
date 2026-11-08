"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { FormResult } from "@/lib/actions";
import { useToast } from "@/components/Toaster";

/**
 * A form whose server action can refuse (returning { ok: false, message })
 * without losing what was typed: it is dispatched by hand, so React doesn't
 * reset the fields, and the refusal shows at the top with "Nothing was saved
 * yet". A save that redirects needs nothing more; one that returns
 * { ok: true, message } says so in a toast (`✓ message`, even when the save
 * moves the row this form sits in), closes the popover or fold it sits in,
 * and with `clearOnSave` empties the form for the next entry. A refusal can carry `fresh` field values (a record's new version
 * after someone else changed it), so saving again goes through on purpose.
 */
export default function KeepTypedForm({
  action,
  className,
  clearOnSave = false,
  onSaved,
  children,
}: {
  action: (prev: FormResult, formData: FormData) => Promise<FormResult>;
  className?: string;
  clearOnSave?: boolean;
  /** Called after a successful save. */
  onSaved?: () => void;
  children: React.ReactNode;
}) {
  const toast = useToast();
  // The toast goes up as soon as the save answers, not from the effect below: a save that
  // moves its row (a to-do re-dated out of Overdue) replaces this form, and the old one's
  // effect never runs. The toaster lives in the layout, so it outlasts the form.
  const [state, dispatch, pending] = useActionState(async (prev: FormResult, fd: FormData) => {
    const result = await action(prev, fd);
    if (result?.ok) toast(`✓ ${result.message}`);
    return result;
  }, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state) return;
    const f = form.current;
    if (!state.ok) {
      for (const [name, value] of Object.entries(state.fresh ?? {})) {
        const field = f?.elements.namedItem(name);
        if (field instanceof HTMLInputElement) field.value = value;
      }
      return;
    }
    if (clearOnSave) f?.reset();
    f?.closest("details")?.removeAttribute("open");
    onSaved?.();
    // Each save returns a new state object: this runs once per save.
  }, [state]);
  return (
    <form
      ref={form}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        // Not to an enclosing fold that closes on submit: a refusal must stay in view. It closes on success above.
        e.stopPropagation();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        const fd = new FormData(e.currentTarget, submitter instanceof HTMLButtonElement && submitter.name ? submitter : undefined);
        startTransition(() => dispatch(fd));
      }}
    >
      {state && !state.ok ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <b>Nothing was saved yet.</b> {state.message} Your changes are still in the form below.
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="text-sm text-stone-600">
          Saving…
        </p>
      ) : null}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
