"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { runNewsScan } from "./news";
import { setSetting } from "./settings";

/** "Check now": search everyone again in the background; the page shows progress. */
export async function checkNewsNow() {
  // Not awaited: a full scan takes a while. /news is dynamic and refreshes itself while it runs.
  void runNewsScan(true);
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

export async function setNewsEnabled(formData: FormData) {
  setSetting("news.enabled", formData.get("enabled") === "on" ? "on" : "off");
  revalidatePath("/news");
  redirect("/news");
}
