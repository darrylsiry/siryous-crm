/** A page's search param: a string, or an array when the key repeats (?person=a&person=b). */
export type Param = string | string[] | undefined;

/** One value for a search param: the first of a repeated key. */
export function first(v: Param): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * A page of this app to return to (?back=… on an edit page), as path, query
 * and hash; undefined for anything else, so a crafted link can never send the
 * owner to another site after a save.
 */
export function localPath(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\/(?![/\\])/.test(s)) return undefined;
  try {
    const u = new URL(s, "http://app.invalid");
    return u.origin === "http://app.invalid" ? `${u.pathname}${u.search}${u.hash}` : undefined;
  } catch {
    return undefined;
  }
}
