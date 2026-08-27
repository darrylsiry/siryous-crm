"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setSetting, validateContextDir, validateOllamaUrl } from "./settings";
import { isCoachTone } from "./coachTone";

export async function saveAiSettings(formData: FormData) {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  // Validate what can fail before writing anything, so a bad field doesn't half-save.
  const urlRaw = str("ollama_url");
  const url = urlRaw ? validateOllamaUrl(urlRaw) : null;
  if (url && !url.ok) redirect(`/settings?error=${encodeURIComponent(`The AI address wasn't saved — ${url.reason}`)}`);
  const ctx = validateContextDir(str("coach_context_dir"));
  if (!ctx.ok) redirect(`/settings?error=${encodeURIComponent(`The coach notes folder wasn't saved — ${ctx.reason}`)}`);

  const provider = str("provider") === "claude" ? "claude" : "local";
  setSetting("ai.provider", provider);
  setSetting("ai.fallback", formData.get("fallback") ? "claude" : "none");
  // An explicitly typed model wins over the dropdown (lets you name a tag Ollama
  // hasn't listed yet). An empty field keeps the current model rather than
  // wiping it — the dropdown is empty whenever Ollama is unreachable.
  const model = str("model_custom") || str("model");
  if (model) setSetting("ai.model", model);
  if (url?.ok) setSetting("ai.ollama_url", url.url);
  const numCtx = Number(str("num_ctx"));
  setSetting("ai.num_ctx", numCtx > 0 ? String(Math.round(numCtx)) : null);
  // Backups: blank = default (data/backups), "off" = disabled, otherwise a folder.
  setSetting("backup.dir", str("backup_dir") || null);
  const temperature = str("temperature");
  setSetting("ai.temperature", temperature !== "" && !Number.isNaN(Number(temperature)) ? temperature : null);
  // Coach: tone, and whether/where it reads the owner's own notes.
  const tone = str("coach_tone");
  setSetting("coach.tone", isCoachTone(tone) ? tone : null);
  setSetting("coach.use_profile", formData.get("coach_use_profile") ? null : "off");
  // Which AI the coach uses: "default" (same as everything else), "claude", or "local:<model tag>".
  const coachAi = str("coach_ai");
  if (coachAi === "claude") {
    setSetting("coach.provider", "claude");
    setSetting("coach.model", null);
  } else if (coachAi.startsWith("local:") && coachAi.length > 6) {
    setSetting("coach.provider", "local");
    setSetting("coach.model", coachAi.slice(6));
  } else {
    setSetting("coach.provider", null);
    setSetting("coach.model", null);
  }
  setSetting("coach.context_dir", ctx.dir || null);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
