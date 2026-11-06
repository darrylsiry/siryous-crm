"use client";

import { useState } from "react";

const PLACEHOLDER: Record<string, string> = {
  paste: "Paste a transcript, an email thread, or your notes…",
  zoom: "Describe the Zoom call: \"yesterday's call with Sam\", \"the Acme meeting on 7/15\"…",
  meet: "Describe the Google Meet: \"Friday's Meet with Sam\"…",
  gmail: "Describe the thread: \"latest thread with Sam about the proposal\"…",
};

/**
 * The Log page's text box, first (pasting is the common case), with the
 * fetch-from options folded below it. The placeholder follows the source.
 */
export default function LogInput({ hasClaude, aiUsable }: { hasClaude: boolean; aiUsable: boolean }) {
  const [source, setSource] = useState("paste");
  const fetching = source !== "paste";
  return (
    <div className="space-y-3">
      <input type="hidden" name="source" value={source} />
      <label htmlFor="log-raw-text" className="sr-only">
        {fetching ? "What to fetch" : "Content to log"}
      </label>
      <textarea
        id="log-raw-text"
        name="raw_text"
        required
        minLength={10}
        rows={fetching ? 3 : 10}
        placeholder={PLACEHOLDER[source]}
        className="w-full rounded-xl border border-stone-300 p-4 text-sm leading-relaxed focus:border-indigo-400"
      />
      {!aiUsable && !fetching ? (
        <p className="text-xs text-amber-800">Pasting still needs the AI to write the entries — it&apos;s off right now (see above).</p>
      ) : null}
      {hasClaude ? (
        <details className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm" open={fetching}>
          <summary className="cursor-pointer select-none text-sm font-medium text-stone-700">
            {fetching ? `Fetching from ${source === "zoom" ? "Zoom" : source === "meet" ? "Google Meet" : "Gmail"}` : "Fetch from Zoom, Google Meet or Gmail instead ▾"}
          </summary>
          <fieldset className="mt-2 space-y-2">
            <legend className="sr-only">Source</legend>
            {[
              ["paste", "Paste", "Use what's in the box above."],
              ["zoom", "Fetch from Zoom", "Claude fetches the transcript; the AI on this Mac writes the entries."],
              ["meet", "Fetch from Google Meet", "Claude finds the meeting on your Calendar, then its transcript or Gemini notes in Drive."],
              ["gmail", "Fetch from Gmail", "Claude fetches the thread; the AI on this Mac writes the entries."],
            ].map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2.5">
                <input type="radio" name="source_choice" value={value} checked={source === value} onChange={() => setSource(value)} className="mt-1" />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-stone-600">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </details>
      ) : (
        <p className="text-xs text-stone-500">
          Fetching from Zoom, Google Meet or Gmail needs Claude Code (see &ldquo;If you use Claude&rdquo; in the README). It isn&apos;t installed on
          this Mac, so paste the content instead.
        </p>
      )}
    </div>
  );
}
