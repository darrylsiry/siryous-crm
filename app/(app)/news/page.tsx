import Link from "next/link";
import { getAiStatus } from "@/lib/aiStatus";
import { getNewsSettings, newsCounts, newsFeed, newsScanRunning, newsSubjects } from "@/lib/news";
import { markNewsSeen } from "@/lib/navCounts";
import { checkNewsNow, dismissNewsItem, restoreNewsItem, setNewsEnabled } from "@/lib/newsActions";
import PendingButton from "@/components/PendingButton";
import FlashBanner from "@/components/FlashBanner";
import AutoRefresh from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

const smallBtn = "rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ saved?: string; dismissed?: string }> }) {
  const { saved, dismissed } = await searchParams;
  const showDismissed = dismissed === "1";
  const ai = await getAiStatus();
  const s = getNewsSettings();
  const running = newsScanRunning();
  const items = newsFeed({ dismissed: showDismissed });
  // Opening the feed clears its "new since last visit" sidebar badge.
  markNewsSeen();
  const counts = newsCounts();
  const subjects = newsSubjects();
  const checked = subjects.filter((x) => x.checkedAt).length;

  return (
    <div className="max-w-3xl space-y-6">
      {running ? <AutoRefresh seconds={20} /> : null}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">📰 News Feed</h1>
          <p className="mt-1 text-sm text-stone-500">
            Web news about the {subjects.length} people and companies in your CRM, searched once a day. Dismiss what
            you&apos;ve seen; everything else stays here, newest first.
          </p>
        </div>
        <form action={checkNewsNow}>
          <PendingButton
            label={running ? "Searching…" : "Check now"}
            pendingLabel="Starting…"
            pendingNote=""
            className={smallBtn}
            disabled={running || !ai.claude.ok}
            disabledLabel={running ? "Searching…" : "Check now"}
          />
        </form>
      </header>

      {saved ? (
        <FlashBanner cleanHref="/news" className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {saved}
        </FlashBanner>
      ) : null}

      {!ai.claude.ok ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Searching the web uses the Claude tool, which isn&apos;t installed on this Mac. See &ldquo;If you use
          Claude&rdquo; in the README.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-stone-400">
        <span>
          {running ? (
            <span className="text-indigo-700">
              <span className="animate-pulse">●</span> {s.progress ?? "Searching…"} — this page refreshes itself.
            </span>
          ) : !ai.claude.ok ? (
            <>Daily search needs Claude (see above).</>
          ) : s.enabled ? (
            <>
              Daily search is on
              {s.lastRunAt ? <> · last run {new Date(s.lastRunAt).toLocaleString()}</> : <> · first run starts within 15 minutes</>}
              {checked < subjects.length ? <> · {subjects.length - checked} not searched yet</> : null}.
            </>
          ) : (
            <>
              Daily search is off. Turning it on sends your contacts&apos; names, roles and employers to Claude once a
              day to look for news; &ldquo;Check now&rdquo; does it once.
            </>
          )}
          {s.lastError && !running ? <span className="block text-red-700">Last run had a problem: {s.lastError}</span> : null}
        </span>
        <form action={setNewsEnabled} className="flex items-center gap-2">
          <input type="hidden" name="enabled" value={s.enabled ? "off" : "on"} />
          <button className="underline decoration-dotted underline-offset-2 hover:text-indigo-700">
            {s.enabled ? "Pause daily search" : "Turn daily search on"}
          </button>
        </form>
      </div>

      <div className="flex gap-4 border-b border-stone-200 text-sm">
        <Link
          href="/news"
          className={`-mb-px border-b-2 px-1 pb-2 ${!showDismissed ? "border-indigo-600 font-semibold text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"}`}
        >
          Feed ({counts.open})
        </Link>
        <Link
          href="/news?dismissed=1"
          className={`-mb-px border-b-2 px-1 pb-2 ${showDismissed ? "border-indigo-600 font-semibold text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"}`}
        >
          Dismissed ({counts.dismissed})
        </Link>
      </div>

      {!items.length ? (
        <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm italic text-stone-400">
          {showDismissed
            ? "Nothing dismissed."
            : !ai.claude.ok
              ? "No news yet — searching the web needs Claude."
              : running
                ? "No news yet — the first search is working through your contacts."
                : !s.lastRunAt
                  ? "No news yet — turn on the daily search above, or click “Check now”."
              : "No news about your contacts right now."}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((n) => (
            <li key={n.id} className="group rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-base font-semibold leading-snug text-stone-900 hover:text-indigo-700 hover:underline"
                >
                  {n.headline}
                </a>
                <form action={showDismissed ? restoreNewsItem : dismissNewsItem} className="shrink-0">
                  <input type="hidden" name="id" value={n.id} />
                  <button
                    title={showDismissed ? "Put back in the feed" : "Dismiss"}
                    aria-label={showDismissed ? "Restore" : "Dismiss"}
                    className={
                      showDismissed
                        ? smallBtn
                        : "rounded-md px-1.5 text-lg leading-none text-stone-300 hover:bg-stone-100 hover:text-stone-600"
                    }
                  >
                    {showDismissed ? "Restore" : "×"}
                  </button>
                </form>
              </div>
              <div className="mt-0.5 text-xs text-stone-400">
                {n.source ?? new URL(n.url).hostname.replace(/^www\./, "")}
                {n.published ? <> · {fmtDate(n.published)}</> : null}
              </div>
              {n.summary ? <p className="mt-2 text-sm leading-relaxed text-stone-700">{n.summary}</p> : null}
              {n.about.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {n.about.map((a) => (
                    <Link
                      key={a.ref}
                      href={a.href}
                      className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 hover:bg-indigo-50 hover:text-indigo-700"
                    >
                      {a.ref.startsWith("c:") ? "▣ " : ""}
                      {a.name}
                    </Link>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-stone-400">
        Found by Claude with web search only (no access to your mail or calendar). It skips anything it can&apos;t tie
        to the right person or company, so a namesake should rarely slip through — dismiss it if one does.
      </p>
    </div>
  );
}
