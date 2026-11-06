import { CANCELLED } from "@/lib/progress";

/**
 * A failed run's error, led by one plain sentence of what to do, with the
 * technical text behind "Show details". Errors that are already plain
 * (timeouts, "too much text", Ollama not running) are shown as they are.
 */
export function plainError(error: string): { lead: string; detail: string | null } {
  const [main, ...rest] = error.split(/\s*\(Detail:\s*/);
  const detail = rest.length ? rest.join(" (Detail: ").replace(/\)\s*$/, "") : null;
  if (/No JSON object|didn.t have the expected shape|Unexpected token|in JSON at position|JSON\.parse|Raw start:/i.test(main)) {
    return { lead: "The AI's answer came back unreadable. Try again; a larger model in Settings usually fixes this.", detail: error };
  }
  if (/Claude CLI exited|without a result|closed its input early/i.test(main)) {
    return {
      lead: "Claude stopped without an answer. Try again; if it keeps happening, open Terminal and run `claude` once to check it's signed in.",
      detail: error,
    };
  }
  return { lead: main.trim(), detail };
}

export default function ErrorExplain({ error }: { error: string | null }) {
  if (!error) return null;
  if (error === CANCELLED) {
    return <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">{error}</p>;
  }
  const { lead, detail } = plainError(error);
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{lead}</p>
      {detail ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-medium">Show details</summary>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono">{detail}</p>
        </details>
      ) : null}
    </div>
  );
}
