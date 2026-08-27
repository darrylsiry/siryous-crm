export const dynamic = "force-dynamic";

/**
 * Shown to a browser that has no sign-in cookie (see proxy.ts). The normal
 * path in is the launcher, which opens the app with the token already in the
 * URL; this form exists for a second browser.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ bad?: string }> }) {
  const { bad } = await searchParams;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Sign in to your CRM</h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          The easiest way in is to double-click <span className="font-semibold">Start CRM</span> in the CRM folder — it
          opens this page already signed in.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          Only use the box below if you&apos;re signing in from a second browser: copy the sign-in link from{" "}
          <span className="font-semibold">Settings</span> in the browser that already works, or paste the code from
          the file <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">data/auth-token</code> inside the CRM
          folder.
        </p>
      </header>
      {bad ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          That code didn&apos;t match. Try Start CRM again, or copy the link from Settings in a browser that&apos;s
          already signed in.
        </p>
      ) : null}
      <form method="get" action="/" className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <label className="block text-xs font-medium text-stone-600">
          Sign-in code
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
    </div>
  );
}
