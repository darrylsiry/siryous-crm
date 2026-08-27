import Link from "next/link";
import { getDb } from "@/lib/db";
import { analyzeIntake } from "@/lib/intake";
import { getAiStatus } from "@/lib/aiStatus";
import AnalyzeButton from "@/components/AnalyzeButton";
import AiStatusBanner from "@/components/AiStatusBanner";

export const dynamic = "force-dynamic";

export default async function IntakePage({ searchParams }: { searchParams: Promise<{ short?: string }> }) {
  const { short } = await searchParams;
  const ai = await getAiStatus();
  const hasClaude = ai.claude.ok;
  const drafts = getDb()
    .prepare(
      `SELECT id, status, created_at, substr(raw_text, 1, 90) AS preview
       FROM intake_drafts WHERE status IN ('analyzing','ready','error') ORDER BY id DESC LIMIT 5`
    )
    .all() as { id: number; status: string; created_at: string; preview: string }[];

  return (
    <div className="max-w-3xl space-y-6">
      <AiStatusBanner />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">✨ Intake</h1>
        <p className="mt-1 text-sm text-stone-500">
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
          placeholder={"Paste here…\n\ne.g. select-all + copy on a LinkedIn profile page, or an email thread, or your raw notes from a call."}
          className="w-full rounded-xl border border-stone-300 p-4 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none"
        />
        {hasClaude ? (
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" name="research" value="1" defaultChecked />
            Look them up on the web first (sends what you pasted to Claude)
          </label>
        ) : (
          <p className="text-xs text-stone-400">Web look-up needs the Claude app — see &ldquo;If you use Claude&rdquo; in the README. Without it, the analysis works from the pasted text only.</p>
        )}
        <AnalyzeButton disabled={!ai.aiUsable} />
      </form>

      {drafts.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
            Recent analyses
          </h2>
          <ul className="space-y-1.5">
            {drafts.map((d) => (
              <li key={d.id} className="text-sm">
                <Link href={`/intake/${d.id}`} className="font-medium text-indigo-700 hover:underline">
                  #{d.id}
                </Link>{" "}
                <span className={d.status === "error" ? "text-red-600" : d.status === "analyzing" ? "animate-pulse text-indigo-600" : "text-green-700"}>
                  [{d.status}]
                </span>{" "}
                <span className="text-stone-500">{d.preview}…</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-stone-400">
        Runs on this Mac. Nothing leaves your computer unless you tick the web box above, or
        Settings is set to use Claude. You can also add people by hand on the{" "}
        <Link href="/people" className="underline">People</Link> and{" "}
        <Link href="/companies" className="underline">Companies</Link> pages.
      </p>
    </div>
  );
}
