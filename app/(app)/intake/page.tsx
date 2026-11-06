import Link from "next/link";
import { getDb } from "@/lib/db";
import { analyzeIntake } from "@/lib/intake";
import { getAiStatus } from "@/lib/aiStatus";
import AnalyzeButton from "@/components/AnalyzeButton";
import AiStatusBanner from "@/components/AiStatusBanner";
import AiWhereLine from "@/components/AiWhereLine";
import { discardIntake } from "@/lib/intake";
import { stateTone, stateWord } from "@/lib/stateWords";
import { ago } from "@/lib/dates.mjs";

export const metadata = { title: "Intake" };

export const dynamic = "force-dynamic";

export default async function IntakePage({ searchParams }: { searchParams: Promise<{ short?: string; from_log?: string }> }) {
  const { short, from_log } = await searchParams;
  const ai = await getAiStatus();
  const hasClaude = ai.claude.ok;
  const db = getDb();
  // Everything still waiting, however old; failures listed apart so they can't push a ready draft off the page.
  const drafts = db
    .prepare(
      `SELECT id, status, created_at, substr(raw_text, 1, 90) AS preview
       FROM intake_drafts WHERE status IN ('analyzing','ready') ORDER BY status = 'ready' DESC, id DESC`
    )
    .all() as { id: number; status: string; created_at: string; preview: string }[];
  const failed = db
    .prepare(`SELECT id, status, created_at, substr(raw_text, 1, 90) AS preview FROM intake_drafts WHERE status='error' ORDER BY id DESC LIMIT 20`)
    .all() as { id: number; status: string; created_at: string; preview: string }[];
  const failedCount = (db.prepare(`SELECT COUNT(*) n FROM intake_drafts WHERE status='error'`).get() as { n: number }).n;
  // Opened from a Log draft ("create a profile from these notes"): start from that draft's text.
  const fromLog = from_log
    ? (db.prepare(`SELECT COALESCE(fetched_text, raw_text) AS text FROM log_drafts WHERE id=?`).get(Number(from_log)) as { text: string } | undefined)
    : undefined;

  return (
    <div className="max-w-3xl space-y-6">
      <AiStatusBanner />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">✨ Intake</h1>
        <p className="mt-1 text-sm text-stone-600">
          Paste anything — a LinkedIn profile, an email thread, meeting notes. The AI picks
          out the person and company, writes the profile sections in your house
          style, finds connections to your existing network, and suggests next steps.
          If the paste describes a meeting or thread that already happened, it also
          drafts the interaction-log entry (setting last touch). You review everything
          before it's saved.
        </p>
      </header>

      {short ? (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          That was too short to analyze — paste at least a few sentences (a whole LinkedIn profile, an email, or your
          notes from a call).
        </p>
      ) : null}

      <form action={analyzeIntake} className="space-y-3">
        <label htmlFor="intake-raw-text" className="sr-only">
          Text to analyze
        </label>
        <textarea
          id="intake-raw-text"
          name="raw_text"
          aria-label="Text to analyze — a LinkedIn profile, an email thread, or notes"
          required
          minLength={40}
          rows={16}
          defaultValue={fromLog?.text ?? ""}
          placeholder={"Paste here…\n\ne.g. select-all + copy on a LinkedIn profile page, or an email thread, or your raw notes from a call."}
          className="w-full rounded-xl border border-stone-300 p-4 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none"
        />
        {hasClaude ? (
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" name="research" value="1" defaultChecked />
            Look them up on the web first (sends what you pasted to Claude)
          </label>
        ) : (
          <p className="text-xs text-stone-500">Web look-up needs Claude Code — see &ldquo;If you use Claude&rdquo; in the README. Without it, the analysis works from the pasted text only.</p>
        )}
        <AnalyzeButton disabled={!ai.aiUsable} />
      </form>

      {drafts.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">To review · {drafts.length}</h2>
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {drafts.map((d) => {
              const word = stateWord(d.status);
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className={stateTone(word)}>{word}</span>
                    <span className="text-stone-500"> · </span>
                    <span className="text-stone-700">{d.preview.replace(/\s+/g, " ")}…</span>
                    <span className="text-stone-500"> · {ago(d.created_at)}</span>
                  </span>
                  <Link href={`/intake/${d.id}`} className="shrink-0 rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
                    {d.status === "ready" ? "Review" : "Watch"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Failed · {failedCount}</h2>
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {failed.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  <span className={stateTone("Failed")}>Failed</span>
                  <span className="text-stone-500"> · </span>
                  <span className="text-stone-700">{d.preview.replace(/\s+/g, " ")}…</span>
                  <span className="text-stone-500"> · {ago(d.created_at)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Link href={`/intake/${d.id}`} className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
                    See why
                  </Link>
                  <form action={discardIntake.bind(null, d.id)}>
                    <button className="rounded-md px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100">Dismiss</button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AiWhereLine extra={hasClaude ? " unless you tick the web box above" : ""} />
      <p className="text-xs text-stone-500">
        You can also add people by hand on the <Link href="/people" className="underline">People</Link> and{" "}
        <Link href="/companies" className="underline">Companies</Link> pages.
      </p>
    </div>
  );
}
