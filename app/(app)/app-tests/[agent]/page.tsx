import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "@/components/Markdown";
import { readReport } from "@/lib/agentActivity";
import { AGENTS } from "@/lib/agentReports";

export const dynamic = "force-dynamic";

/** One agent's latest report, as it wrote it. */
export default async function AgentReportPage({ params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  const info = AGENTS.find((a) => a.key === agent);
  if (!info) notFound();
  const report = readReport(info.key);
  if (!report) notFound();
  return (
    <div className="max-w-4xl space-y-4">
      <header>
        <Link href={`/app-tests?agent=${info.key}#findings`} className="text-sm text-indigo-600 hover:underline">
          ← App Tests
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{info.name} report</h1>
        <p className="mt-1 text-sm text-stone-500">
          As the <code className="rounded bg-stone-100 px-1 text-xs">{info.agent}</code> agent wrote it on its latest run · saved{" "}
          {report.mtime.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      </header>
      <article className="min-w-0 overflow-x-auto rounded-xl border border-stone-200 bg-white px-6 py-5">
        <Markdown modelWritten>{report.text}</Markdown>
      </article>
    </div>
  );
}
