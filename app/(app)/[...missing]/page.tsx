import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Catch-all for URLs no page matches. Without it Next would render its bare
 * default 404 outside the app chrome; routing unknown paths through this
 * segment shows app/(app)/not-found.tsx inside the sidebar layout instead.
 */
export default function MissingPage() {
  notFound();
}
