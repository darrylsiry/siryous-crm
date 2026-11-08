export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

/**
 * Shown to a browser that has no sign-in cookie (see proxy.ts). The normal
 * path in is the launcher, which opens the app with a one-time code; this form
 * takes a one-time link from Settings → Access, or the token itself.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ bad?: string }> }) {
  const { bad } = await searchParams;
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Sign in to your CRM</h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          The easiest way in is to double-click <span className="font-semibold">Start CRM</span> in the CRM folder; it
          opens the CRM signed in.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          Signing in another browser? In a browser that&apos;s already signed in, open{" "}
          <span className="font-semibold">Settings → Access</span> and click <span className="font-semibold">Make a sign-in link</span>, then
          paste it below or into this browser&apos;s address bar. It works once, within two minutes. The code in the file{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">data/auth-token</code> in the CRM folder works too.
        </p>
      </header>
      {bad ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          That didn&apos;t match. A sign-in link works once and only for two minutes: make a new one in Settings → Access,
          or use the code from <code>data/auth-token</code>, or just double-click Start CRM.
        </p>
      ) : null}
      <form method="post" action="/api/signin" className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <label className="block text-xs font-medium text-stone-600">
          Sign-in link or code
          <input
            name="token"
            required
            placeholder="http://127.0.0.1:3000/?once=…"
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
