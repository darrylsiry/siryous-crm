"use client";

import { startTransition, useActionState } from "react";
import type { FormResult } from "@/lib/actions";

/**
 * A form whose server action can refuse (returning { ok: false, message })
 * without losing what was typed: it is dispatched by hand, so React doesn't
 * reset the fields, and the refusal shows at the top with "Nothing was saved
 * yet". A successful save is expected to redirect.
 */
export default function KeepTypedForm({
  action,
  className,
  children,
}: {
  action: (prev: FormResult, formData: FormData) => Promise<FormResult>;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, dispatch, pending] = useActionState(action, null);
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
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
