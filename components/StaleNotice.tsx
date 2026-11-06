import Link from "next/link";

/**
 * Shown after an edit was refused because the record changed underneath the
 * form (optimistic-concurrency check in lib/actions.ts). `href` is the clean
 * page URL, so "Reload" also clears the ?stale=1 flag. `kept`: a section
 * edit met a newer version and was saved below it instead (?stale=kept).
 */
export default function StaleNotice({ href, kept = false }: { href: string; kept?: boolean }) {
  if (kept) {
    return (
      <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        A section you saved had been changed elsewhere while you were editing (perhaps from another window, or from
        Claude). Nothing was lost: your text is below the newer version, marked ⚠. Edit the section to merge them.{" "}
        <Link href={href} className="font-semibold underline">
          Dismiss
        </Link>
      </p>
    );
  }
  return (
    <p
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      This record changed while you were editing (perhaps from another window, or from Claude).{" "}
      <Link href={href} className="font-semibold underline">
        Reload
      </Link>{" "}
      and try again — your edit was not saved.
    </p>
  );
}
