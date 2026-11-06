/**
 * Process-wide state kept on globalThis. Next.js compiles instrumentation.ts,
 * pages and server actions as separate entries, and nothing guarantees they
 * share one copy of a module, so a plain module variable could exist twice:
 * two local-model queues running side by side, or a second inbox poll starting
 * while the first is in flight. One bag per process, whatever the bundling.
 */
const KEY = Symbol.for("siryous-crm.serverState");

type Bag = Record<string, unknown>;

/** The process's one `name` entry, created by `init` on first use. */
export function shared<T>(name: string, init: () => T): T {
  const g = globalThis as typeof globalThis & { [KEY]?: Bag };
  const bag = (g[KEY] ??= {});
  if (!(name in bag)) bag[name] = init();
  return bag[name] as T;
}
