"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { receiptFor } from "@/lib/receiptActions";

/**
 * "✓ Saved 2 entries (Sam Lee, Priya Rao) · closed 1 to-do — 3 more to
 * review → Next", on whatever page a Log or Intake confirmation lands on
 * (a profile, or the Inbox for a draft that came from an email). Driven by
 * ?receipt=log-<id>; the flag is removed from the URL once shown.
 */
export default function ReceiptBanner() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const ref = params.get("receipt");
  const [shown, setShown] = useState<{ line: string; next: { href: string; remaining: number } | null } | null>(null);
  useEffect(() => {
    if (!ref) return;
    let live = true;
    receiptFor(ref).then((r) => {
      if (!live) return;
      setShown(r);
      const rest = new URLSearchParams(params.toString());
      rest.delete("receipt");
      router.replace(`${pathname}${rest.size ? `?${rest}` : ""}${window.location.hash}`, { scroll: false });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  if (!shown) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-900">
      <span>✓ {shown.line}</span>
      <span className="flex items-center gap-3">
        {shown.next ? (
          <Link href={shown.next.href} onClick={() => setShown(null)} className="font-semibold text-green-800 underline">
            {shown.next.remaining} more to review → Next
          </Link>
        ) : null}
        <button type="button" onClick={() => setShown(null)} aria-label="Close" className="text-green-700 hover:text-green-900">
          ×
        </button>
      </span>
    </div>
  );
}
