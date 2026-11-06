"use client";

import { useTransition } from "react";
import { clearNextStep, reopenActionItem, tickActionItem } from "@/lib/actions";
import { useToast, type ToastAction } from "@/components/Toaster";

/**
 * Tick a to-do done. The row leaves its list straight away, so a toast says
 * what was ticked and offers Undo (and, when the to-do repeated someone's next
 * step, to clear that too). `label` gives a text button ("Got it") instead of
 * the box. The hit area is 40px on phones.
 */
export default function DoneTick({ id, title, label }: { id: number; title: string; label?: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const tick = () =>
    start(async () => {
      const r = await tickActionItem(id);
      if (!r) return;
      const actions: ToastAction[] = [{ label: "Undo", run: () => reopenActionItem(id) }];
      if (r.nextStep) {
        const ns = r.nextStep;
        actions.push({ label: `Clear ${ns.name.split(/\s+/)[0] || "their"}'s next step too`, run: () => clearNextStep(ns) });
      }
      toast(`✓ Done: ${r.title}`, actions);
    });
  if (label) {
    return (
      <button
        type="button"
        onClick={tick}
        disabled={pending}
        aria-label={`${label}: ${title}`}
        className="shrink-0 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-600 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-60 sm:py-0.5"
      >
        {pending ? "…" : label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={tick}
      disabled={pending}
      aria-label={`Mark done: ${title}`}
      title="Mark done"
      className="group -m-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-md disabled:cursor-progress sm:-m-1 sm:h-6 sm:w-6"
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded border text-[0.6rem] leading-none transition-colors ${
          pending
            ? "border-indigo-500 bg-indigo-50 text-indigo-600"
            : "border-stone-400 bg-white text-transparent group-hover:border-indigo-500 group-hover:bg-indigo-50 group-hover:text-indigo-600"
        }`}
      >
        ✓
      </span>
    </button>
  );
}
