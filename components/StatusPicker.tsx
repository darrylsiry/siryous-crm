"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStatus } from "@/lib/actions";

/**
 * The status badge as a button: click it and a small menu of every status
 * opens; pick one and it's saved straight away (note and next action are
 * left alone). Used on the People/Companies lists and the profile headers.
 * `statuses` is passed in because the vocabulary lives server-side.
 */
export default function StatusPicker({
  entity,
  id,
  statusKey,
  note,
  updatedAt,
  statuses,
  compact = false,
}: {
  entity: "person" | "company";
  id: number;
  statusKey: string;
  note?: string | null;
  /** Row's updated_at at render time — the save refuses to overwrite a newer row. */
  updatedAt: string | null;
  statuses: Record<string, { emoji: string; label: string; color: string }>;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(statusKey);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLSpanElement>(null);

  // Keep in sync if the row re-renders with fresh data (e.g. after router.refresh()).
  useEffect(() => setCurrent(statusKey), [statusKey]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const s = statuses[current] ?? statuses.new ?? { emoji: "", label: current, color: "" };

  const choose = (key: string) => {
    setOpen(false);
    if (key === current) return;
    const previous = current;
    setCurrent(key);
    setError(null);
    startTransition(async () => {
      const r = await setStatus(entity, id, key, updatedAt);
      if (!r.ok) {
        setCurrent(previous);
        setError(r.reason);
        return;
      }
      router.refresh();
    });
  };

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen((v) => !v);
        }}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        title={note ? `${note} — click to change status` : "Click to change status"}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.color} cursor-pointer hover:brightness-95 disabled:opacity-60`}
      >
        <span>{s.emoji}</span>
        <span>{pending ? "Saving…" : s.label}</span>
        {!compact && note ? <span className="font-normal opacity-75 max-w-48 truncate">· {note}</span> : null}
        <span aria-hidden className="ml-0.5 opacity-60">▾</span>
      </button>
      {open ? (
        <span
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 flex min-w-44 flex-col gap-0.5 rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg"
        >
          {Object.entries(statuses).map(([key, st]) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={key === current}
              onClick={() => choose(key)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-stone-100 ${key === current ? "font-semibold" : ""}`}
            >
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-inset ${st.color}`}>{st.emoji}</span>
              <span className="text-stone-800">{st.label}</span>
              {key === current ? <span className="ml-auto text-stone-400">✓</span> : null}
            </button>
          ))}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
          {error}
        </span>
      ) : null}
    </span>
  );
}
