/** URL-safe slug from a person or company name (shared by the app, the MCP server and scripts). */
export { slugify, slugFor, profilePath } from "./rules.mjs";

/** A slug from a route segment. A slug in a non-Latin script may arrive percent-encoded; a slug never holds "%". */
export function slugParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

