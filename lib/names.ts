/** Display names for keys the AI writes. Plain functions, safe in client components (lib/slug.ts isn't: it imports node:crypto). */
/**
 * A slug the AI wrote, as a name to show ("sam-lee" → "Sam Lee",
 * "company:acme-robotics" → "Acme Robotics"), for one that isn't in the CRM
 * and so has no name of its own.
 */
export function nameFromSlug(slug: string): string {
  return slug
    .replace(/^company:/, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** A Log source as the owner knows it. */
export function sourceName(source: string): string {
  return ({ gmail: "Gmail", zoom: "Zoom", meet: "Google Meet", email: "the email", paste: "your notes" } as Record<string, string>)[source] ?? source;
}
