"use client";

import { useEffect } from "react";

/**
 * One-shot notice driven by a query flag (e.g. /settings?saved=1). On mount it
 * rewrites the URL to `cleanHref` so a reload or a copied link doesn't show
 * the banner again; the banner itself stays visible until navigation.
 */
export default function FlashBanner({
  cleanHref,
  className,
  children,
}: {
  cleanHref: string;
  className?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, "", cleanHref);
    } catch {
      /* ignore — the banner is still correct, the URL just keeps the flag */
    }
  }, [cleanHref]);
  return (
    <p role="status" className={className}>
      {children}
    </p>
  );
}
