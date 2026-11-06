"use client";

import { useState } from "react";
import { makeSignInLink } from "@/lib/settingsActions";
import CopyButton from "@/components/CopyButton";

/**
 * Settings → Access: makes a one-time sign-in link on request, so the page
 * itself never holds anything that signs a browser in.
 */
export default function SignInLink() {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      setLink(await makeSignInLink());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={make}
        disabled={busy}
        className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-60"
      >
        {busy ? "Making a link…" : link ? "Make another link" : "Make a sign-in link"}
      </button>
      {link ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-stone-100 px-2 py-1 font-mono text-xs text-stone-800">{link}</code>
          <CopyButton text={link} />
        </div>
      ) : null}
      {link ? <p className="text-xs text-stone-500">It works once, in the next two minutes. Making another replaces it.</p> : null}
    </div>
  );
}
