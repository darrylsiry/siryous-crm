import { tokenPath } from "@/lib/auth.mjs";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ bad?: string }> }) {
  const { bad } = await searchParams;
  return (
    <div className="mx-auto max-w-lg space-y-5 py-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">This CRM is locked to its machine</h1>
        <p className="mt-2 text-sm text-stone-600">
          A private token was generated when the app first started. Present it once and this browser stays
          signed in. The easiest way is <span className="font-medium">Start CRM.command</span>, which opens the app
          already signed in; otherwise paste the contents of the token file below.
        </p>
      </header>
      {bad ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          That token didn&apos;t match. Copy it again from the file — it&apos;s a single line, no spaces.
        </p>
      ) : null}
      <form method="get" action="/" className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <label className="block text-xs font-medium text-stone-600">
          Token
          <input
            name="token"
            required
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          Sign in
        </button>
      </form>
      <p className="text-xs text-stone-400">
        The token lives in <code>{tokenPath()}</code> on the machine running the app. Its startup log also prints a
        sign-in link. To run without a token, set <code>CRM_AUTH=off</code> in <code>.env.local</code>.
      </p>
    </div>
  );
}
