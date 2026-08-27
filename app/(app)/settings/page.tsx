import Link from "next/link";
import { getAiSettings, getSetting } from "@/lib/settings";
import { getAiStatus } from "@/lib/aiStatus";
import { getDb } from "@/lib/db";
import { lastBackup } from "@/lib/backup.mjs";
import { loadOwner } from "@/lib/owner.mjs";
import { authEnabled, signInUrl } from "@/lib/auth.mjs";
import { saveAiSettings } from "@/lib/settingsActions";
import PendingButton from "@/components/PendingButton";
import FlashBanner from "@/components/FlashBanner";
import CopyButton from "@/components/CopyButton";
import { OLLAMA_SITE } from "@/components/AiStatusBanner";

export const dynamic = "force-dynamic";

const input = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";
const label = "block text-xs font-medium text-stone-600";
const h2 = "text-sm font-semibold uppercase tracking-wide text-stone-500";
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const s = getAiSettings();
  const ai = await getAiStatus();
  const models = ai.model.available;
  const modelListed = ai.model.ok;
  const backup = lastBackup(getDb());
  const owner = loadOwner();
  const backupSetting = getSetting("backup.dir") ?? "";
  const port = process.env.PORT || "3000";
  const link = signInUrl(`http://127.0.0.1:${port}`);
  const isMac = process.platform === "darwin";

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">⚙ Settings</h1>
        <p className="mt-1 text-sm text-stone-500">
          Where the AI runs and which model does the thinking for Intake, Log, Prep, and Coach. Changes apply to the
          next run — no restart needed.
        </p>
      </header>

      {saved ? (
        <FlashBanner cleanHref="/settings" className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          Saved.
        </FlashBanner>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className={h2}>Access</h2>
        {authEnabled() ? (
          <div className="mt-2 space-y-2 text-sm text-stone-700">
            <p>This browser is signed in. To sign in another browser (or after clearing cookies), open this link there:</p>
            <div className="flex flex-wrap items-center gap-2">
              <a href={link} className="min-w-0 flex-1 break-all rounded bg-stone-100 px-2 py-1 font-mono text-xs text-indigo-700 underline">
                {link}
              </a>
              <CopyButton text={link} />
            </div>
            <p className="text-xs text-stone-500">
              Anyone with this link can open your CRM — treat it like a password. To get a new one, delete the file{" "}
              <code>data/auth-token</code> in the CRM folder and restart the CRM.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-amber-800">
            Sign-in is turned off, so anything running on this computer can open the CRM. (developers: <code>CRM_AUTH=off</code>)
          </p>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className={h2}>Tell the AI who you are</h2>
        {owner.configured ? (
          <p className="mt-2 text-sm text-stone-700">
            The AI writes for <span className="font-semibold">{owner.ownerName}</span> · {owner.practiceName}
            {owner.coachContextDir ? <> · coach notes folder: <code>{owner.coachContextDir}</code></> : null}. To change
            this, edit <code>config/owner.json</code> in the CRM folder and restart the CRM.
          </p>
        ) : (
          <div className="mt-2 space-y-2 text-sm text-amber-800">
            <p>The AI doesn&apos;t know your name or what your practice does yet, so it writes in generic terms. To fix that:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                In the CRM folder, open <code>config</code>, duplicate <code>owner.example.json</code> and name the copy{" "}
                <code>owner.json</code>.
              </li>
              <li>Open <code>owner.json</code> in any text editor, fill in your name and practice, save, and restart the CRM.</li>
            </ol>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className={h2}>AI on this Mac</h2>
        {!ai.ollama.ok ? (
          <div className="mt-2 space-y-2 text-sm text-red-700">
            <p>
              <span className="font-semibold">Ollama isn&apos;t running</span>
              {isMac
                ? " — open it from your Applications folder (look for the llama in the menu bar), then reload this page."
                : " — start it, then reload this page."}{" "}
              {ai.provider === "local"
                ? ai.fallbackToClaude && ai.claude.ok
                  ? "Until then, runs use Claude instead (and send their text to Anthropic)."
                  : ai.fallbackToClaude
                    ? "Until then the AI features won't run — and Claude isn't installed, so it can't fill in."
                    : "Until then the AI features won't run."
                : null}
            </p>
            {ai.ollama.installedHint === "not-installed" ? (
              <p>
                <a href={OLLAMA_SITE} target="_blank" rel="noreferrer" className="font-medium underline">
                  Get Ollama (ollama.com)
                </a>{" "}
                — it&apos;s free.
              </p>
            ) : null}
            <p className="text-xs text-stone-400">Detail: {ai.ollama.reason}</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-stone-700">
            <span className="font-semibold text-green-700">Running</span> · {models.length} model{models.length === 1 ? "" : "s"}{" "}
            downloaded · in use: <span className={modelListed ? "font-semibold text-green-700" : "font-semibold text-red-700"}>{s.model}</span>
            {modelListed ? null : (
              <span className="block text-red-700">
                This model hasn&apos;t been downloaded yet — choose a downloaded model below, or open Terminal and run{" "}
                <code>ollama pull {s.model}</code>.
              </span>
            )}
          </p>
        )}
      </section>

      <form action={saveAiSettings} className="space-y-5">
        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-4">
          <h2 className={h2}>AI model</h2>

          <label className={label}>
            AI model
            <select
              name="model"
              defaultValue={modelListed ? (models.find((m) => m.name === s.model || m.name === `${s.model}:latest`)?.name ?? s.model) : s.model}
              className={input}
            >
              {modelListed ? null : (
                <option value={s.model}>
                  {s.model} (current — {ai.ollama.ok ? "not downloaded yet" : "can't check while Ollama is off"})
                </option>
              )}
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.parameter_size ? ` · ${m.parameter_size} parameters` : ""}
                  {m.size ? ` · ${gb(m.size)} on disk` : ""}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-stone-400">
              {ai.ollama.ok
                ? "Only models already downloaded in Ollama are listed. Smaller models are faster and need less memory; larger ones write better."
                : "The list appears once Ollama is running. You can type a model name under Advanced instead."}
            </span>
          </label>

          <label className={label}>
            How much text the AI can read at once
            <input name="num_ctx" type="number" min={2048} step={1024} defaultValue={s.numCtx} className={input} />
            <span className="mt-1 block text-xs text-stone-400">
              Larger uses more memory. Raise this if you see &lsquo;too much text&rsquo;. 32768 suits a 26B model on a 32–36 GB Mac.
            </span>
          </label>

          <details className="rounded-lg border border-stone-200 bg-stone-50 p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-stone-500">Advanced</summary>
            <div className="mt-3 space-y-4">
              <label className={label}>
                Or type a model tag (overrides the dropdown)
                <input name="model_custom" placeholder="e.g. qwen3:32b — must be downloaded before use" className={input} />
              </label>
              <label className={label}>
                Temperature
                <input name="temperature" type="number" min={0} max={2} step={0.1} defaultValue={s.temperature} className={input} />
                <span className="mt-1 block text-xs text-stone-400">Lower = more literal and better JSON. 0.2–0.4 recommended.</span>
              </label>
              <label className={label}>
                Ollama URL
                <input name="ollama_url" defaultValue={s.ollamaUrl} className={input} />
                <span className="mt-1 block text-xs text-stone-400">
                  Local or private-network addresses only (e.g. http://mini.local:11434 for another machine on your network).
                </span>
              </label>
            </div>
          </details>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
          <h2 className={h2}>Where the AI runs</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="provider" value="local" defaultChecked={s.provider === "local"} className="mt-1" />
            <span>
              <span className="font-medium">On this Mac (private)</span>
              <span className="block text-xs text-stone-500">
                Your contacts and notes never leave this machine. Claude is used only for steps that need Gmail, Calendar, Zoom, Drive, or the web.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="provider" value="claude" defaultChecked={s.provider === "claude"} className="mt-1" />
            <span>
              <span className="font-medium">Claude</span> (sends your data to Anthropic; needs a subscription)
              <span className="block text-xs text-stone-500">
                {ai.claude.ok
                  ? "Claude is set up on this Mac."
                  : "Claude isn't set up on this Mac, so this option won't work until it is — see “If you use Claude” in the README."}
              </span>
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" name="fallback" value="1" defaultChecked={s.fallbackToClaude} className="mt-1" />
            <span>
              If the AI on this Mac isn&apos;t available, use Claude instead (sends the request to Anthropic)
              {ai.claude.ok ? null : (
                <span className="block text-xs text-amber-800">Claude isn&apos;t set up on this Mac, so this has no effect right now.</span>
              )}
            </span>
          </label>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
          <h2 className={h2}>Backups</h2>
          <p className="text-sm text-stone-600">
            {backup.dir ? (
              <>
                A copy of your CRM is saved once a day to <code>{backup.dir}</code>
                {backup.file ? <> — newest: <code>{backup.file}</code></> : <> — none yet</>}. The newest 30 are kept.
              </>
            ) : (
              "Automatic backups are off."
            )}
          </p>
          <label className={label}>
            Backup folder
            <input
              name="backup_dir"
              defaultValue={backupSetting}
              placeholder="Leave blank to keep backups inside the CRM folder; type off to disable"
              className={input}
            />
            <span className="mt-1 block text-xs text-stone-400">
              Point this at a synced folder (Google Drive, iCloud, Dropbox) if you want off-machine copies — the whole CRM goes there unencrypted, so
              that is your call. <code>~/</code> is understood.
            </span>
          </label>
        </section>

        <div className="flex items-center gap-3">
          <PendingButton label="Save settings" pendingLabel="Saving…" pendingNote="" />
        </div>
      </form>

      <p className="text-xs text-stone-400">
        Back to <Link href="/" className="underline">Dashboard</Link>.
      </p>
    </div>
  );
}
