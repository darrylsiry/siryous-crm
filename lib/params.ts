/** A page's search param: a string, or an array when the key repeats (?person=a&person=b). */
export type Param = string | string[] | undefined;

/** One value for a search param: the first of a repeated key. */
export function first(v: Param): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
