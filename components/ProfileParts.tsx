import Link from "next/link";
import { BUCKETS, PICKABLE_BUCKETS, getDb } from "@/lib/db";
import { backupDir } from "@/lib/backup.mjs";
import type { ActionItemJoined } from "@/lib/types";
import { ActionRow } from "@/components/ActionList";
import AddTodoButton from "@/components/AddTodoButton";
import QuickLog from "@/components/QuickLog";
import { profilePath } from "@/lib/slug";

const BTN =
  "inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:border-indigo-400 hover:text-indigo-700";

/** A phone number as a tel: link target (digits and a leading +). */
function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 6 ? `tel:${digits}` : null;
}

/** The first email address in a field that may hold several or some text. */
function mailHref(email: string): string | null {
  const m = email.match(/[^\s<>(),;]+@[^\s<>(),;]+\.[^\s<>(),;]+/);
  return m ? `mailto:${m[0]}` : null;
}

/**
 * The action bar under a profile's header: everything the owner comes to a
 * profile to do, without scrolling. Call and Email appear when the snapshot
 * has a number or address; Edit opens the profile's edit page.
 */
export function ProfileActions({
  person,
  company,
}: {
  person?: { id: number; slug: string; name: string; company_id: number | null; email: string | null; phone: string | null };
  company?: { id: number; slug: string; name: string; website: string | null };
}) {
  const buckets = Object.entries(PICKABLE_BUCKETS).map(([key, b]) => ({ key, label: b.label, icon: b.icon }));
  const tel = person?.phone ? telHref(person.phone) : null;
  const mail = person?.email ? mailHref(person.email) : null;
  const dealHref = person ? `/pipeline?person=${encodeURIComponent(person.slug)}#add` : `/pipeline?company=${encodeURIComponent(company!.slug)}#add`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <QuickLog
        personId={person?.id}
        companyId={person ? person.company_id : company?.id}
        name={person?.name ?? company!.name}
        align="left"
        buttonClassName="inline-flex items-center gap-1 rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
      />
      {person ? (
        <Link href={`/prep?person=${encodeURIComponent(person.slug)}`} className={BTN}>
          🗓 Prep
        </Link>
      ) : null}
      <AddTodoButton buckets={buckets} personId={person?.id} companyId={person ? undefined : company?.id} className={BTN} />
      <Link href={dealHref} className={BTN}>
        ⚑ Add deal
      </Link>
      {tel ? (
        <a href={tel} className={BTN}>
          📞 Call
        </a>
      ) : null}
      {mail ? (
        <a href={mail} className={BTN}>
          ✉ Email
        </a>
      ) : null}
      <Link href={`${person ? profilePath("people", person.slug) : profilePath("companies", company!.slug)}/edit`} className={BTN}>
        ✎ Edit
      </Link>
    </div>
  );
}

/** "Open with Sam — 3": what the owner has promised this person or company, at the top of the profile. */
export function OpenTodos({ name, items }: { name: string; items: ActionItemJoined[] }) {
  if (!items.length) return null;
  return (
    <section className="rounded-xl border border-amber-200 bg-white">
      <h2 className="border-b border-amber-100 px-5 py-2.5 text-sm font-semibold text-stone-800">
        ☑ Open with {name} — {items.length}
      </h2>
      <ul className="divide-y divide-stone-100 px-5 py-1">
        {items.map((a) => (
          <ActionRow key={a.id} item={a} />
        ))}
      </ul>
    </section>
  );
}

/** The Danger zone's last line: where the backups really are, or that there are none. */
export function RestoreNote() {
  const dir = backupDir(getDb());
  if (!dir) {
    return (
      <>
        There is no undo, and <strong>backups are off</strong> (
        <Link href="/settings#backups" className="font-medium text-indigo-700 hover:underline">
          Settings
        </Link>
        ), so this can&apos;t be recovered.
      </>
    );
  }
  return (
    <>
      There is no undo: restore from a backup in
      <code className="mx-1 break-all rounded bg-stone-100 px-1 py-0.5 text-xs">{dir}</code>
      if this was a mistake. Those backups also keep what you delete until they age out after 30 days (
      <Link href="/settings#backups" className="font-medium text-indigo-700 hover:underline">
        backup status
      </Link>
      ).
    </>
  );
}
