import Link from "next/link";
import type { ActionItemJoined } from "@/lib/types";
import { completeActionItem, deleteActionItem, reopenActionItem } from "@/lib/actions";
import ConfirmButton from "./ConfirmButton";
import Markdown from "./Markdown";
import SubmitButton from "./SubmitButton";

export function ActionRow({ item, done = false }: { item: ActionItemJoined; done?: boolean }) {
  const action = done ? reopenActionItem.bind(null, item.id) : completeActionItem.bind(null, item.id);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <form action={action} className="pt-0.5">
        <SubmitButton
          title={done ? "Reopen" : "Mark done"}
          className={`h-4.5 w-4.5 rounded border text-[0.65rem] leading-none ${
            done
              ? "border-green-400 bg-green-100 text-green-700"
              : "border-stone-300 bg-white text-transparent hover:border-indigo-400 hover:text-indigo-300"
          }`}
        >
          ✓
        </SubmitButton>
      </form>
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${done ? "text-stone-400 line-through" : "text-stone-800"}`}>
          <Markdown>{item.detail ?? item.title}</Markdown>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-400">
          {item.due_date || item.due_label ? (
            <span className={`font-medium ${!done && item.bucket === "overdue" && item.bucket_raw !== "overdue" ? "text-red-700" : "text-amber-700"}`}>
              due {item.due_date ?? item.due_label}
              {item.due_date && item.due_label && item.due_label !== item.due_date ? ` (${item.due_label})` : ""}
            </span>
          ) : null}
          {item.person_name ? (
            <Link href={`/people/${item.person_slug}`} className="hover:text-indigo-600">
              {item.person_name}
            </Link>
          ) : null}
          {item.company_name ? (
            <Link href={`/companies/${item.company_slug}`} className="hover:text-indigo-600">
              {item.company_name}
            </Link>
          ) : null}
          {item.source ? <span>· {item.source}</span> : null}
          {done && item.completed_at ? <span>done {item.completed_at}</span> : null}
        </div>
      </div>
      {!done ? (
        <form action={deleteActionItem.bind(null, item.id)} className="pt-0.5">
          <ConfirmButton
            label="×"
            confirm={`Delete this action item? This can't be undone.\n\n${item.title}`}
            className="rounded px-1.5 text-base leading-none text-stone-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
          />
        </form>
      ) : null}
    </li>
  );
}
