import Link from "next/link";
import type { ActionItemJoined } from "@/lib/types";
import { deleteActionItem, reopenActionItem } from "@/lib/actions";
import ConfirmButton from "./ConfirmButton";
import Markdown from "./Markdown";
import SubmitButton from "./SubmitButton";
import ActionEdit from "./ActionEdit";
import DoneTick from "./DoneTick";
import { shortDate } from "@/lib/dates.mjs";

/** A to-do's one-line wording, the same on every screen: its title, markup stripped. */
export function todoTitle(item: Pick<ActionItemJoined, "title">): string {
  return item.title.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim() || item.title;
}

/** The to-do's longer text, when it says more than the title. */
export function todoDetail(item: Pick<ActionItemJoined, "title" | "detail">): string | null {
  const d = item.detail?.trim();
  return d && d !== item.title.trim() ? d : null;
}

export function ActionRow({ item, done = false }: { item: ActionItemJoined; done?: boolean }) {
  const title = todoTitle(item);
  const detail = todoDetail(item);
  const waiting = !done && item.bucket_raw === "awaiting";
  return (
    <li id={`item-${item.id}`} className="flex scroll-mt-20 items-start gap-3 py-2.5 target:bg-amber-50">
      {done ? (
        <form action={reopenActionItem.bind(null, item.id)} className="pt-0.5">
          <SubmitButton
            title="Reopen"
            className="flex h-4.5 w-4.5 items-center justify-center rounded border border-green-400 bg-green-100 text-[0.65rem] leading-none text-green-700"
          >
            <span aria-hidden>✓</span>
            <span className="sr-only">Reopen: {title}</span>
          </SubmitButton>
        </form>
      ) : (
        <span className="pt-0.5">
          <DoneTick id={item.id} title={title} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${done ? "text-stone-500 line-through" : "text-stone-800"}`}>{title}</div>
        {detail ? (
          <details className="mt-0.5 text-sm">
            <summary className="cursor-pointer text-xs text-stone-500 hover:text-stone-800">Details</summary>
            <div className="mt-1 text-stone-700">
              <Markdown>{detail}</Markdown>
            </div>
          </details>
        ) : null}
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500">
          {item.due_date || item.due_label ? (
            <span className={`font-medium ${!done && item.bucket === "overdue" && item.bucket_raw !== "overdue" ? "text-red-700" : "text-amber-700"}`}>
              due {item.due_date ? shortDate(item.due_date) : item.due_label}
              {item.due_date && item.due_label && item.due_label !== item.due_date ? ` (${item.due_label})` : ""}
            </span>
          ) : null}
          {waiting ? <span className="font-medium text-sky-700">waiting on reply{item.bucket === "overdue" ? " — chase" : ""}</span> : null}
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
          {done && item.completed_at ? <span>done {shortDate(item.completed_at) || item.completed_at}</span> : null}
          {!done ? <ActionEdit item={item}>✎ Edit</ActionEdit> : null}
        </div>
      </div>
      {!done ? (
        <form action={deleteActionItem.bind(null, item.id)} className="pt-0.5">
          <ConfirmButton
            label="×"
            ariaLabel={`Delete: ${title}`}
            confirm={`Delete this to-do? This can't be undone. (Ticking it done keeps it in Recently completed.)\n\n${title}`}
            className="-m-2 rounded px-3 py-2 text-base leading-none text-stone-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-60 sm:m-0 sm:px-1.5 sm:py-0"
          />
        </form>
      ) : null}
    </li>
  );
}
