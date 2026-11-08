"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSetting, setSetting, validateContextDir, validateOllamaUrl } from "./settings";
import { isCoachTone } from "./coachTone";
import { ensureDailyBackup, validateBackupDir } from "./backup.mjs";
import { getDb } from "./db";
import type { FormResult } from "./actions";
import fs from "node:fs";
import path from "node:path";
import { loadOwner, OWNER_FORM_FIELDS, resetOwner } from "./owner.mjs";
import { cookies } from "next/headers";
import { AUTH_COOKIE, createSignInCode, endOtherSessions, sessionFor } from "./auth.mjs";

/**
 * Settings → About you: write the owner's name, practice and email into
 * config/owner.json (keeping every other key in it), so nobody has to edit
 * JSON by hand. Refuses when the file exists but can't be read, rather than
 * overwriting whatever is in it.
 */
export async function saveOwnerProfile(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const owner = loadOwner();
  if (owner.readError) {
    return { ok: false, message: `config/owner.json couldn't be read (${owner.readError}). Fix it or remove it, then try again.` };
  }
  const file = owner.configPath;
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* no file yet */
  }
  for (const k of OWNER_FORM_FIELDS) {
    const v = String(formData.get(k) ?? "").trim();
    if (v.length > 500) return { ok: false, message: "One of the fields is too long (500 characters at most)." };
    current[k] = v;
  }
  const email = String(current.ownerEmail ?? "");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: `"${email}" doesn't look like an email address.` };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  resetOwner();
  revalidatePath("/", "layout");
  redirect("/settings?saved=1#about");
}

/** "Use this model": switch to a model Ollama already has, from the AI notice. */
export async function useModel(model: string) {
  const m = String(model ?? "").trim();
  if (!m || m.length > 100) return;
  setSetting("ai.model", m);
  revalidatePath("/", "layout");
}

export async function saveAiSettings(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  // Validate what can fail before writing anything, so a bad field doesn't half-save
  // (the form keeps what was typed and says which field to fix).
  const urlRaw = str("ollama_url");
  const url = urlRaw ? validateOllamaUrl(urlRaw) : null;
  if (url && !url.ok) return { ok: false, message: `Ollama URL: ${url.reason}` };
  const ctx = validateContextDir(str("coach_context_dir"));
  if (!ctx.ok) return { ok: false, message: `Coach notes folder: ${ctx.reason}` };
  const backup = validateBackupDir(str("backup_dir"));
  if (!backup.ok) return { ok: false, message: `Backup folder: ${backup.reason}` };

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
  const backupChanged = (getSetting("backup.dir") ?? "") !== backup.dir;
  setSetting("backup.dir", backup.dir || null);
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
  // A new folder (or a retry after a failure) gets today's backup now, so Settings shows straight away whether it works.
  if (backupChanged || getSetting("backup.last_error")) await ensureDailyBackup(getDb());
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

/**
 * Settings → Access: a link that signs one more browser on this Mac in. It
 * holds a one-time code (good once, for two minutes), never the token.
 */
export async function makeSignInLink(): Promise<string> {
  return `http://127.0.0.1:${process.env.PORT || "3000"}/?once=${createSignInCode()}`;
}

/** Settings → Access: end every sign-in but this browser's own (a lost laptop, a copied cookie). */
export async function signOutOtherBrowsers() {
  endOtherSessions(sessionFor((await cookies()).get(AUTH_COOKIE)?.value));
  redirect("/settings?signedout=1#access");
}
