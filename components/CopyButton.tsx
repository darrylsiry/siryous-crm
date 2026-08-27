"use client";

import { useEffect, useState } from "react";

/** Small "Copy link" button: puts `text` on the clipboard and says "Copied" for a moment. */
export default function CopyButton({ text, label = "Copy link", className }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={
        className ??
        "rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
      }
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy — select the link and copy it" : label}
    </button>
  );
}
