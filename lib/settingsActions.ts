"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setSetting, validateOllamaUrl } from "./settings";

export async function saveAiSettings(formData: FormData) {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const provider = str("provider") === "claude" ? "claude" : "local";
  setSetting("ai.provider", provider);
  setSetting("ai.fallback", formData.get("fallback") ? "claude" : "none");
  // An explicitly typed model wins over the dropdown (lets you name a tag Ollama
  // hasn't listed yet). An empty field keeps the current model rather than
  // wiping it — the dropdown is empty whenever Ollama is unreachable.
  const model = str("model_custom") || str("model");
  if (model) setSetting("ai.model", model);
  const urlRaw = str("ollama_url");
  if (urlRaw) {
    const v = validateOllamaUrl(urlRaw);
    if (!v.ok) redirect(`/settings?error=${encodeURIComponent(`Ollama URL not saved: ${v.reason}`)}`);
    setSetting("ai.ollama_url", v.url);
  }
  const numCtx = Number(str("num_ctx"));
  setSetting("ai.num_ctx", numCtx > 0 ? String(Math.round(numCtx)) : null);
  // Backups: blank = default (data/backups), "off" = disabled, otherwise a folder.
  setSetting("backup.dir", str("backup_dir") || null);
  const temperature = str("temperature");
  setSetting("ai.temperature", temperature !== "" && !Number.isNaN(Number(temperature)) ? temperature : null);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
