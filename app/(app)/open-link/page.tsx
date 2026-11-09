import { first, type Param } from "@/lib/params";
import { isExternal, linkHost, safeHref, withoutQuery } from "@/lib/safeHref";

export const metadata = { title: "Open this link?" };

const primary = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700";
const secondary = "rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50";

/**
 * The stop before leaving the CRM (lib/safeHref.ts throughCheck). A link in
 * rendered text may have been written by a steered model, and whatever is in
 * its address reaches the other site on the click, so the whole address is
 * shown here first. Nothing goes anywhere until the owner clicks. This page
 * fetches nothing and changes nothing, so it does no harm if opened by itself.
 */
export default async function OpenLinkPage({ searchParams }: { searchParams: Promise<{ to?: Param }> }) {
  const { to } = await searchParams;
  const safe = safeHref(first(to));
  const host = safe && isExternal(safe) ? linkHost(safe) : "";
  if (!safe || !host) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Nothing to open</h1>
        <p className="text-sm text-stone-600">That isn&apos;t a web address. You can close this tab.</p>
      </div>
    );
  }
  // The address as the browser would send it: a look-alike domain shows as its real xn-- form.
  const whole = new URL(safe).toString();
  const page = withoutQuery(whole);
  const hasExtra = page !== whole;
  return (
    <div className="max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Open this link?</h1>
        <p className="mt-1 text-sm text-stone-600">
          It&apos;s in text an AI may have written, so here is exactly where it goes. Whatever is in the address reaches
          that site when you open it.
        </p>
      </header>
      <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5 text-sm">
        <dl className="grid grid-cols-[5rem_1fr] gap-y-2 text-stone-700">
          <dt className="text-stone-500">Site</dt>
          <dd className="font-semibold text-stone-900">{host}</dd>
          <dt className="text-stone-500">Address</dt>
          <dd>
            <code className="break-all">{whole}</code>
          </dd>
        </dl>
        <p className="text-stone-600">
          If the address has names, notes or anything else from your CRM in it, don&apos;t open it: close this tab.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={page} rel="noopener noreferrer" className={primary}>
            {hasExtra ? "Open the page only" : `Open ${host}`}
          </a>
          {hasExtra ? (
            <a href={whole} rel="noopener noreferrer" className={secondary}>
              Open the whole address
            </a>
          ) : null}
        </div>
        {hasExtra ? (
          <p className="text-xs text-stone-500">
            The page only leaves off everything after the <code>?</code> or <code>#</code>. Most pages open fine without it;
            a few, like a video link, need it.
          </p>
        ) : null}
      </section>
    </div>
  );
}
