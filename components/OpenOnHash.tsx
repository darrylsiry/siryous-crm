"use client";

import { useEffect } from "react";

/**
 * Opens the folded section (<details>) a link jumps to, on load and when the
 * #hash changes, so "12 long overdue" shows the items rather than a closed
 * one-line summary.
 */
export default function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (el instanceof HTMLDetailsElement && !el.open) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
