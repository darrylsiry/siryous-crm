"use client";

import { useEffect, useRef, useState } from "react";
import AddActionForm from "@/components/AddActionForm";
import { usePopoverPosition } from "@/components/usePopoverPosition";

/** "Add to-do" on a profile: the Actions page's form in a popover, with the person or company preset. */
export default function AddTodoButton({
  buckets,
  personId,
  companyId,
  className,
}: {
  buckets: { key: string; label: string; icon: string }[];
  personId?: number;
  companyId?: number;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const place = usePopoverPosition(open, button, { width: 480, height: 280, align: "left" });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative inline-block">
      <button ref={button} type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={className}>
        ＋ Add to-do
      </button>
      {open ? (
        <div style={place} className={`${place ? "" : "invisible absolute"} z-40 rounded-lg border border-stone-200 bg-white p-4 shadow-lg`}>
          <AddActionForm buckets={buckets} personId={personId} companyId={companyId} onAdded={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
