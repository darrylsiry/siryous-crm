import Link from "next/link";

/**
 * Shown after an edit was refused because the record changed underneath the
 * form (optimistic-concurrency check in lib/actions.ts). `href` is the clean
 * page URL, so "Reload" also clears the ?stale=1 flag.
 */
export default function StaleNotice({ href }: { href: string }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      This record changed while you were editing (probably via Claude).{" "}
      <Link href={href} className="font-semibold underline">
        Reload
      </Link>{" "}
      and try again — your edit was not saved.
    </p>
  );
}
