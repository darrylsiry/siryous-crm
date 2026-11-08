"use client";

import { useRef, useState } from "react";
import { usePopoverPosition } from "@/components/usePopoverPosition";

/**
 * A <details> whose panel floats next to its summary like the other popovers
 * (usePopoverPosition): fixed to the window and kept on screen, so on a phone
 * a panel opened from the middle of a row isn't cut off. It snaps shut when a
 * form inside it is submitted, as ClosingDetails does.
 */
export default function FloatingDetails({
  summary,
  summaryClassName,
  title,
  className,
  panelClassName,
  width = 320,
  height = 340,
  children,
}: {
  summary: React.ReactNode;
  summaryClassName?: string;
  title?: string;
  className?: string;
  panelClassName?: string;
  width?: number;
  height?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const anchor = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const place = usePopoverPosition(open, anchor, { width, height, align: "left" });
  return (
    <details
      ref={ref}
      className={className}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      onSubmit={() => ref.current?.removeAttribute("open")}
    >
      <summary ref={anchor} className={summaryClassName} title={title}>
        {summary}
      </summary>
      <div style={place ?? { position: "fixed", visibility: "hidden" }} className={`z-30 ${panelClassName ?? ""}`}>
        {children}
      </div>
    </details>
  );
}
