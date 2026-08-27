import Link from "next/link";
import { notFound } from "next/navigation";
import { outreachById } from "@/lib/queries";
import Markdown from "@/components/Markdown";

export const dynamic = "force-dynamic";

export default async function OutreachDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const o = outreachById(Number(id));
  if (!o) notFound();
  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/outreach" className="text-xs text-stone-400 hover:text-indigo-600">
        ← Outreach
      </Link>
      <div className="rounded-xl border border-stone-200 bg-white p-6">
        <Markdown>{o.body ?? ""}</Markdown>
      </div>
      {o.person_slug ? (
        <p className="text-sm text-stone-500">
          Related profile:{" "}
          <Link href={`/people/${o.person_slug}`} className="font-medium text-indigo-700 hover:underline">
            {o.person_name}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
