"use client";

import { useTransition } from "react";
import { logTouch } from "@/lib/actions";
import { useToast } from "@/components/Toaster";

/**
 * "Save as typed" beside an AI form's main button: the same fields saved as
 * an interaction exactly as written (logTouch), with no AI. The form's text
 * box is `textName`; the toast says what happened and the box clears.
 */
export default function SaveAsTypedButton({ textName = "raw_text" }: { textName?: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        const form = e.currentTarget.form;
        if (!form || !form.reportValidity()) return;
        const fd = new FormData(form);
        fd.set("note", String(fd.get(textName) ?? ""));
        start(async () => {
          const r = await logTouch(null, fd);
          if (!r) return;
          toast(r.ok ? `✓ ${r.message}` : `Not saved: ${r.message}`);
          if (r.ok) (form.elements.namedItem(textName) as HTMLTextAreaElement | null)?.form?.reset();
        });
      }}
      className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save as typed"}
    </button>
  );
}
