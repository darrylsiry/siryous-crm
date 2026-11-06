"use client";

import { useState } from "react";
import { isIsoDate, parseDueDate } from "@/lib/dates.mjs";

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("sv-SE");
}

function nextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d.toLocaleDateString("sv-SE");
}

function pretty(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/**
 * One "Due" box: a date or free text ("Fri 7/25", "Nov 12", "ASAP"), with
 * quick-date chips and a line saying what it understood, so the owner sees
 * whether the to-do will carry a date. The server parses it the same way.
 */
export default function DueField({ required = false, name = "due" }: { required?: boolean; name?: string }) {
  const [value, setValue] = useState("");
  const date = isIsoDate(value.trim()) ? value.trim() : parseDueDate(value);
  const chip = "rounded-full border border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-600 hover:border-indigo-400 hover:text-indigo-700";
  return (
    <div>
      <input
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={required}
        placeholder="Fri 7/25, Nov 12, ASAP…"
        className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
      />
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip} onClick={() => setValue(localDate(1))}>
          Tomorrow
        </button>
        <button type="button" className={chip} onClick={() => setValue(nextMonday())}>
          Next Mon
        </button>
        <button type="button" className={chip} onClick={() => setValue(localDate(7))}>
          +1 week
        </button>
        <span aria-live="polite" className={`text-xs ${date ? "text-stone-600" : value.trim() ? "text-amber-700" : "text-stone-500"}`}>
          {date ? `→ ${pretty(date)}` : value.trim() ? "no date in that — kept as a note" : required ? "a date is needed for this group" : "optional"}
        </span>
      </div>
    </div>
  );
}
