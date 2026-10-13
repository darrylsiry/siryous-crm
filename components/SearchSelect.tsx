"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface SearchOption {
  value: string;
  label: string;
  /** Extra text shown dimmed after the label and matched by the search (e.g. a person's company). */
  hint?: string | null;
  /** Options with the same group are listed together under that heading (ungrouped first). */
  group?: string;
}

/**
 * A drop-in replacement for a <select> of people or companies: the options
 * are listed alphabetically, and a search box at the top of the list narrows
 * them to the ones whose name (or hint) contains every word typed. The value
 * travels in a hidden input named `name`, so forms and server actions read it
 * exactly as they read the select. Works uncontrolled (defaultValue) or
 * controlled (value + onChange).
 */
export default function SearchSelect({
  name,
  options,
  defaultValue = "",
  value: controlled,
  onChange,
  emptyLabel = "—",
  allowEmpty = true,
  placeholder = "Type to search…",
  className = "",
  ariaLabel,
}: {
  name: string;
  options: SearchOption[];
  defaultValue?: string | number | null;
  value?: string;
  onChange?: (value: string) => void;
  /** Label of the "nothing chosen" choice (and of the button when empty). */
  emptyLabel?: string;
  /** Offer the empty choice at the top of the list. */
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [inner, setInner] = useState(defaultValue == null ? "" : String(defaultValue));
  const value = controlled ?? inner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  const sorted = useMemo(() => {
    const cmp = (a: SearchOption, b: SearchOption) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
    const groups: string[] = [];
    for (const o of options) if (o.group && !groups.includes(o.group)) groups.push(o.group);
    return [
      ...options.filter((o) => !o.group).sort(cmp),
      ...groups.flatMap((g) => options.filter((o) => o.group === g).sort(cmp)),
    ];
  }, [options]);

  const shown = useMemo(() => {
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const terms = norm(query).split(/\s+/).filter(Boolean);
    const hits = terms.length
      ? sorted.filter((o) => {
          const hay = norm(`${o.label} ${o.hint ?? ""}`);
          return terms.every((t) => hay.includes(t));
        })
      : sorted;
    return allowEmpty && !terms.length ? [{ value: "", label: emptyLabel } as SearchOption, ...hits] : hits;
  }, [sorted, query, allowEmpty, emptyLabel]);

  const selected = options.find((o) => o.value === value);

  function choose(v: string) {
    if (controlled === undefined) setInner(v);
    onChange?.(v);
    setOpen(false);
    setQuery("");
  }

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // On open: focus the search box and highlight the current choice.
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const i = shown.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault(); // never submit the surrounding form from the search box
      const o = shown[active];
      if (o) choose(o.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    } else if (e.key === "Tab") {
      setOpen(false);
      setQuery("");
    }
  }

  let lastGroup: string | undefined;
  return (
    <div ref={root} className="relative inline-block w-full align-middle">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || (e.key.length === 1 && /\S/.test(e.key))) {
            e.preventDefault();
            if (e.key.length === 1) setQuery(e.key);
            setOpen(true);
          }
        }}
        className={`flex w-full items-center justify-between gap-2 text-left ${className}`}
      >
        <span className={`truncate ${selected ? "" : "text-stone-400"}`}>
          {selected ? (
            <>
              {selected.label}
              {selected.hint ? <span className="text-stone-400"> — {selected.hint}</span> : null}
            </>
          ) : (
            emptyLabel
          )}
        </span>
        <span aria-hidden className="shrink-0 text-[0.6rem] text-stone-400">▼</span>
      </button>
      {open ? (
        <div
          // These pickers usually sit inside a <label>; a click in the popup must not
          // fall through to the label (which would re-click the button and reopen it).
          onClick={(e) => e.preventDefault()}
          className="absolute left-0 z-30 mt-1 w-full min-w-[16rem] rounded-lg border border-stone-200 bg-white p-1.5 shadow-lg"
        >
          <input
            ref={search}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder={placeholder}
            role="combobox"
            aria-controls={listId}
            aria-expanded
            className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm font-normal text-stone-800 focus:border-indigo-400 focus:outline-none"
          />
          <ul ref={list} id={listId} role="listbox" className="mt-1 max-h-64 overflow-y-auto text-sm font-normal">
            {shown.length === 0 ? <li className="px-2 py-1.5 italic text-stone-400">No match</li> : null}
            {shown.map((o, i) => {
              const header = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <li key={`${o.value}-${i}`} role="presentation">
                  {header ? (
                    <div className="mt-1 border-t border-stone-100 px-2 pb-0.5 pt-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-stone-400">
                      {header}
                    </div>
                  ) : null}
                  <div
                    role="option"
                    aria-selected={o.value === value}
                    data-i={i}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o.value)}
                    className={`cursor-pointer truncate rounded px-2 py-1 ${i === active ? "bg-indigo-50 text-indigo-800" : "text-stone-700"} ${o.value === value ? "font-semibold" : ""} ${o.value === "" ? "text-stone-400" : ""}`}
                  >
                    {o.label}
                    {o.hint ? <span className="text-xs text-stone-400"> — {o.hint}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
