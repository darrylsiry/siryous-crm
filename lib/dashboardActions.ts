"use server";

// Dashboard buttons: tick a to-do done, dismiss a news item.
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";

function refresh() {
  revalidatePath("/");
}

export async function dashboardCompleteAction(id: number) {
  getDb().prepare(`UPDATE action_items SET status='done', completed_at=date('now','localtime') WHERE id=?`).run(id);
  refresh();
  revalidatePath("/actions");
}

export async function dashboardDismissNews(id: number) {
  getDb().prepare(`UPDATE news_items SET dismissed_at=datetime('now') WHERE id=?`).run(id);
  refresh();
  revalidatePath("/news");
}
