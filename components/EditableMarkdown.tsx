"use client";

import { useState } from "react";
import Markdown from "@/components/Markdown";

/**
 * A draft's text shown as it will read (rendered Markdown), with ✎ Edit to
 * swap in the text box. The value always travels in the form under `name`.
 */
export default function EditableMarkdown({
  name,
  defaultValue,
  label,
}: {
  name: string;
  defaultValue: string;
  label: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [editing, setEditing] = useState(false);
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-stone-600">{label}</span>
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          {editing ? "Done editing" : "✎ Edit"}
        </button>
      </div>
      {editing ? (
        <textarea
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={label}
          rows={Math.min(16, Math.max(5, value.split("\n").length + 1))}
          className="mt-1 w-full rounded-lg border border-stone-300 p-3 text-sm leading-relaxed"
          autoFocus
        />
      ) : (
        <>
          <input type="hidden" name={name} value={value} />
          <div className="mt-1 rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm">
            {value.trim() ? <Markdown>{value}</Markdown> : <p className="italic text-stone-500">Empty — this entry won&apos;t be saved.</p>}
          </div>
        </>
      )}
    </div>
  );
}
