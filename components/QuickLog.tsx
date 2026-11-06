"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { logTouch } from "@/lib/actions";
import { useToast } from "@/components/Toaster";
import { usePopoverPosition } from "@/components/usePopoverPosition";

const CHANNELS = ["Call", "Email", "Meeting", "Text"];
const LAST_CHANNEL = "crm.lastChannel";

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("sv-SE");
}

/**
 * "Log touch": record a call or meeting in a few seconds from wherever the
 * owner already is (Keep Warm, the Dashboard, a profile) without leaving the
 * page. Channel chips remember the last one used; the date defaults to today.
 * Saved as typed, no AI.
 */
export default function QuickLog({
  personId,
  companyId,
  name,
  align = "right",
  buttonClassName,
}: {
  personId?: number | null;
  companyId?: number | null;
  name: string;
  align?: "left" | "right";
  buttonClassName?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [logged, setLogged] = useState(false);
  const [channel, setChannel] = useState("Call");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const note = useRef<HTMLInputElement>(null);
  const place = usePopoverPosition(open, button, { width: 352, height: 300, align });

  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_CHANNEL);
      if (last && CHANNELS.includes(last)) setChannel(last);
    } catch {
      /* private window: keep the default */
    }
  }, []);

  // Called straight from the submit, not from an effect: on the Dashboard and
  // Keep Warm the row (and this component) can be gone by the time it re-renders.
  const save = (fd: FormData) =>
    start(async () => {
      setError(null);
      const r = await logTouch(null, fd);
      if (!r) return;
      if (!r.ok) {
        setError(r.message);
        return;
      }
      toast(`✓ ${r.message}`);
      setOpen(false);
      setLogged(true);
      try {
        localStorage.setItem(LAST_CHANNEL, channel);
      } catch {
        /* ignore */
      }
    });

  useEffect(() => {
    if (!open) return;
    setDate(localDate());
    note.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!personId && !companyId) return null;
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-stone-300 bg-white text-stone-600 hover:border-stone-400"}`;
  return (
    <div ref={root} className="relative inline-block text-left">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={
          buttonClassName ??
          "rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:border-indigo-400 hover:text-indigo-700"
        }
      >
        {logged && !open ? "✓ Logged" : "Log touch"}
      </button>
      {open ? (
        <form
          // Saved by hand (not a form action) so React doesn't clear the fields when the save is refused.
          onSubmit={(e) => {
            e.preventDefault();
            save(new FormData(e.currentTarget));
          }}
          style={place}
          className={`${place ? "" : "invisible absolute"} z-40 space-y-2.5 rounded-lg border border-stone-200 bg-white p-3 text-xs font-normal text-stone-700 shadow-lg`}
        >
          <p className="font-semibold text-stone-800">Log a touch with {name}</p>
          {personId ? <input type="hidden" name="person_id" value={personId} /> : null}
          {companyId ? <input type="hidden" name="company_id" value={companyId} /> : null}
          <input type="hidden" name="channel" value={channel} />
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Channel">
            {CHANNELS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={channel === c} onClick={() => setChannel(c)} className={chip(channel === c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              name="date"
              value={date}
              max={localDate()}
              onChange={(e) => setDate(e.target.value)}
              required
              aria-label="Date"
              className="rounded border border-stone-300 px-2 py-1"
            />
            <button type="button" onClick={() => setDate(localDate())} className={chip(date === localDate())}>
              Today
            </button>
            <button type="button" onClick={() => setDate(localDate(-1))} className={chip(date === localDate(-1))}>
              Yesterday
            </button>
          </div>
          <input
            ref={note}
            name="note"
            placeholder="What happened? (optional)"
            aria-label="What happened"
            className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
          />
          <div className="flex gap-1.5">
            <input
              name="next_step"
              placeholder="Next step (optional)"
              aria-label="Next step"
              className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1.5 text-sm"
            />
            <input type="date" name="next_due" aria-label="Next step due" title="With a date, the next step also goes on your to-dos" className="w-32 rounded border border-stone-300 px-1.5 py-1" />
          </div>
          <p className="text-stone-500">Saved as typed. A next step with a date also goes on your to-dos.</p>
          {error ? <p role="alert" className="font-medium text-red-700">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
