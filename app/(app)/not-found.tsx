import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-2xl font-bold tracking-tight">Not found</h1>
      <p className="text-sm text-stone-500">That page or record doesn&apos;t exist (it may have been deleted or merged).</p>
      <Link href="/" className="text-sm font-medium text-indigo-700 hover:underline">← Dashboard</Link>
    </div>
  );
}
