"use client";

import { useLayoutEffect, useState } from "react";

/**
 * Where to draw a popover opened from `anchor`: fixed to the window rather
 * than its parent, so a table that scrolls sideways (People, Companies, Keep
 * Warm) can't clip it. It opens below the button, or above when there isn't
 * room below, lines up with the button's right (or left) edge and stays on
 * screen. Follows the button on scroll and resize.
 */
export function usePopoverPosition(
  open: boolean,
  anchor: React.RefObject<HTMLElement | null>,
  { width, height = 320, align = "right" }: { width: number; height?: number; align?: "left" | "right" }
): React.CSSProperties | undefined {
  const [style, setStyle] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(width, vw - 16);
      const left = Math.max(8, Math.min(align === "right" ? r.right - w : r.left, vw - w - 8));
      const below = vh - r.bottom;
      const up = below < Math.min(height, vh / 2) && r.top > below;
      setStyle({
        position: "fixed",
        left,
        width: w,
        ...(up ? { bottom: vh - r.top + 4 } : { top: r.bottom + 4 }),
        maxHeight: (up ? r.top : below) - 12,
        overflowY: "auto",
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, width, height, align]);
  return open ? style : undefined;
}
