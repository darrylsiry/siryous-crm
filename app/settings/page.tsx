import Link from "next/link";
import { getAiSettings, AI_DEFAULTS } from "@/lib/settings";
import { listLocalModels, type OllamaModel } from "@/lib/llm";
import { getDb } from "@/lib/db";
import { lastBackup } from "@/lib/backup.mjs";
import { getSetting } from "@/lib/settings";
import { loadOwner } from "@/lib/owner.mjs";
import { saveAiSettings } from "@/lib/settingsActions";
import PendingButton from "@/components/PendingButton";

export const dynamic = "force-dynamic";

const input = "mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm";
const label = "block text-xs font-medium text-stone-600";
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const s = getAiSettings();
  let models: OllamaModel[] = [];
  let ollamaError: string | null = null;
  try {
    models = await listLocalModels(s.ollamaUrl);
  } catch (err) {
    ollamaError = err instanceof Error ? err.message : String(err);
  }
  const modelListed = models.some((m) => m.name === s.model || m.name === `${s.model}:latest`);
  const backup = lastBackup(getDb());
  const owner = loadOwner();
  const backupSetting = getSetting("backup.dir") ?? "";

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">⚙ Settings</h1>
        <p className="mt-1 text-sm text-stone-500">
          Which model does the thinking for Intake, Log, Prep, and Coach. Changes apply to the next run — no restart needed.
        </p>
      </header>

      {saved ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">Saved.</p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Owner profile</h2>
        {owner.configured ? (
          <p className="mt-2 text-sm text-stone-700">
            Prompts are written for <span className="font-semibold">{owner.ownerName}</span> · {owner.practiceName}
            {owner.coachContextDir ? <> · coach context: <code>{owner.coachContextDir}</code></> : null}. Edit <code>config/owner.json</code> and restart to change.
          </p>
        ) : (
          <p className="mt-2 text-sm text-amber-800">
            No owner profile yet — prompts use generic wording. Copy <code>config/owner.example.json</code> to <code>config/owner.json</code>, fill in your name and practice, and restart.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Ollama status</h2>
        {ollamaError ? (
          <p className="mt-2 text-sm text-red-700">
            Not reachable at <code>{s.ollamaUrl}</code> — {ollamaError}. Start Ollama (the desktop app or <code>ollama serve</code>). Until then, runs
            {s.fallbackToClaude ? " fall back to Claude." : " will fail (fallback is off)."}
          </p>
        ) : (
          <p className="mt-2 text-sm text-stone-700">
            Reachable at <code>{s.ollamaUrl}</code> · {models.length} model{models.length === 1 ? "" : "s"} pulled · in use:{" "}
            <span className={modelListed ? "font-semibold text-green-700" : "font-semibold text-red-700"}>{s.model}</span>
            {modelListed ? "" : " (not pulled — run: ollama pull " + s.model + ")"}
          </p>
        )}
      </section>

      <form action={saveAiSettings} className="space-y-5">
        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Local model</h2>

          <label className={label}>
            Model (pulled in Ollama)
            <select name="model" defaultValue={modelListed ? (models.find((m) => m.name === s.model || m.name === `${s.model}:latest`)?.name ?? s.model) : s.model} className={input}>
              {modelListed ? null : <option value={s.model}>{s.model} (current — not in Ollama's list)</option>}
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.parameter_size ? ` · ${m.parameter_size}` : ""}
                  {m.quantization ? ` · ${m.quantization}` : ""}
                  {m.size ? ` · ${gb(m.size)}` : ""}
                </option>
              ))}
            </select>
            {ollamaError ? <span className="mt-1 block text-xs text-stone-400">List unavailable while Ollama is down — type a tag below instead.</span> : null}
          </label>

          <label className={label}>
            Or type a model tag (overrides the dropdown)
            <input name="model_custom" placeholder="e.g. qwen3:32b — must be pulled before use" className={input} />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Context window (tokens)
              <input name="num_ctx" type="number" min={2048} step={1024} defaultValue={s.numCtx} className={input} />
              <span className="mt-1 block text-xs text-stone-400">
                Long transcripts and the Coach snapshot need room. Bigger = more memory; 32768 suits a 26B model on a 32–36 GB machine.
              </span>
            </label>
            <label className={label}>
              Temperature
              <input name="temperature" type="number" min={0} max={2} step={0.1} defaultValue={s.temperature} className={input} />
              <span className="mt-1 block text-xs text-stone-400">Lower = more literal and better JSON. 0.2–0.4 recommended.</span>
            </label>
          </div>

          <label className={label}>
            Ollama URL
            <input name="ollama_url" defaultValue={s.ollamaUrl} className={input} />
            <span className="mt-1 block text-xs text-stone-400">Local or private-network addresses only (e.g. http://mini.local:11434 for another machine on your LAN).</span>
          </label>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Provider</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="provider" value="local" defaultChecked={s.provider === "local"} className="mt-1" />
            <span>
              <span className="font-medium">Local model</span> for all thinking and writing. Claude is used only for steps that need Gmail, Calendar, Zoom, Drive, or the web.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="provider" value="claude" defaultChecked={s.provider === "claude"} className="mt-1" />
            <span>
              <span className="font-medium">Claude</span> for everything (the pre-August behavior; uses your Claude subscription for every run).
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" name="fallback" value="1" defaultChecked={s.fallbackToClaude} className="mt-1" />
            <span>
              <span className="font-medium">Fall back to Claude automatically</span> if the local model is unavailable or fails. Untick to keep runs strictly local (they will error instead).
            </span>
          </label>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Backups</h2>
          <p className="text-sm text-stone-600">
            {backup.dir ? (
              <>
                A copy of the database is written once a day to <code>{backup.dir}</code>
                {backup.file ? <> — newest: <code>{backup.file}</code></> : <> — none yet</>}. The newest 30 are kept.
              </>
            ) : (
              "Automatic backups are off."
            )}
          </p>
          <label className={label}>
            Backup folder
            <input name="backup_dir" defaultValue={backupSetting} placeholder="blank = data/backups next to the database · off = disable" className={input} />
            <span className="mt-1 block text-xs text-stone-400">
              Point this at a synced folder (Google Drive, iCloud, Dropbox) if you want off-machine copies — the whole CRM goes there unencrypted, so that is your call. <code>~/</code> is understood.
            </span>
          </label>
        </section>

        <div className="flex items-center gap-3">
          <PendingButton label="Save settings" pendingLabel="Saving…" pendingNote="" />
          <span className="text-xs text-stone-400">
            Defaults come from <code>.env.local</code> (currently {AI_DEFAULTS.model} · {AI_DEFAULTS.provider}
            {AI_DEFAULTS.fallbackToClaude ? " · fallback on" : " · fallback off"}); saved settings override them.
          </span>
        </div>
      </form>

      <p className="text-xs text-stone-400">
        Back to <Link href="/" className="underline">Dashboard</Link>.
      </p>
    </div>
  );
}
