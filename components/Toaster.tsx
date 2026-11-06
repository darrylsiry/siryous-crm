"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Short confirmations at the bottom of the screen ("✓ Done: Send proposal ·
 * Undo"), so a tick or a quick log says what happened even though the row it
 * came from has already left the list. One provider in the app layout; any
 * client component calls `useToast()`.
 */
export interface ToastAction {
  label: string;
  run: () => Promise<unknown> | void;
}
interface Toast {
  key: number;
  message: string;
  actions: ToastAction[];
}

const ToastContext = createContext<(message: string, actions?: ToastAction[]) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** How long a toast stays up, unless the pointer or keyboard focus is on it. */
const SHOW_MS = 9000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((message: string, actions: ToastAction[] = []) => {
    const key = next.current++;
    // Newest last; three at most.
    setToasts((ts) => [...ts.slice(-2), { key, message, actions }]);
  }, []);
  const drop = useCallback((key: number) => setToasts((ts) => ts.filter((t) => t.key !== key)), []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <ToastItem key={t.key} toast={t} onClose={() => drop(t.key)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (held) return;
    const t = setTimeout(onClose, SHOW_MS);
    return () => clearTimeout(t);
  }, [held, onClose]);
  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-lg bg-stone-900 px-4 py-2.5 text-sm text-white shadow-lg"
    >
      <span className="min-w-0 truncate">{toast.message}</span>
      {toast.actions.map((a) => (
        <button
          key={a.label}
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await a.run();
            } finally {
              onClose();
            }
          }}
          className="shrink-0 rounded px-2 py-0.5 font-semibold text-indigo-300 hover:bg-white/10 hover:text-indigo-200 disabled:opacity-60"
        >
          {a.label}
        </button>
      ))}
      <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded px-1 text-stone-300 hover:text-white">
        ×
      </button>
    </div>
  );
}
