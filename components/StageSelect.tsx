"use client";

/** A deal's stage: choosing one saves it straight away (the form's server action does the work). */
export default function StageSelect({ stage, stages }: { stage: string; stages: { key: string; label: string; icon: string }[] }) {
  return (
    <select
      name="stage"
      defaultValue={stage}
      aria-label="Stage (saves when changed)"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="rounded border border-stone-300 bg-white px-1.5 py-1 text-xs text-stone-700"
    >
      {stages.map((s) => (
        <option key={s.key} value={s.key}>
          {s.icon} {s.label}
        </option>
      ))}
    </select>
  );
}
