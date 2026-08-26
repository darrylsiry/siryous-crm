import { STATUS } from "@/lib/db";

export default function StatusBadge({
  statusKey,
  note,
  compact = false,
}: {
  statusKey: string;
  note?: string | null;
  compact?: boolean;
}) {
  const s = STATUS[statusKey] ?? STATUS.new;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.color}`}
      title={note ?? undefined}
    >
      <span>{s.emoji}</span>
      <span>{s.label}</span>
      {!compact && note ? (
        <span className="font-normal opacity-75 max-w-48 truncate">· {note}</span>
      ) : null}
    </span>
  );
}
