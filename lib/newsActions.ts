"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { requestNewsStop, runNewsScan } from "./news";
import { setSetting } from "./settings";

/** "Check now": search everyone again in the background; the page shows progress. */
export async function checkNewsNow() {
  // Not awaited: a full scan takes a while. /news is dynamic and refreshes itself while it runs.
  void runNewsScan(true).catch((err) => {
    console.error("[news] check failed:", err);
    setSetting("news.last_error", err instanceof Error ? err.message : String(err));
  });
  redirect("/news?saved=" + encodeURIComponent("Searching the web — new items appear here as each batch finishes."));
}

export async function dismissNewsItem(formData: FormData) {
  const id = Number(formData.get("id"));
  if (id) getDb().prepare(`UPDATE news_items SET dismissed_at=datetime('now') WHERE id=?`).run(id);
  revalidatePath("/news");
  revalidatePath("/");
}

export async function restoreNewsItem(formData: FormData) {
  const id = Number(formData.get("id"));
  if (id) getDb().prepare(`UPDATE news_items SET dismissed_at=NULL WHERE id=?`).run(id);
  revalidatePath("/news");
}

/** Stop a running scan, scheduled or "Check now", before its next batch. */
export async function stopNewsScan() {
  requestNewsStop();
  redirect("/news?saved=" + encodeURIComponent("Stopping: the batch already sent finishes, and no more are sent."));
}

export async function setNewsEnabled(formData: FormData) {
  const on = formData.get("enabled") === "on";
  setSetting("news.enabled", on ? "on" : "off");
  // Pausing also ends a daily scan that is under way.
  if (!on) requestNewsStop();
  revalidatePath("/news");
  redirect("/news");
}
