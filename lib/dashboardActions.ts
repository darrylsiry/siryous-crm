"use server";

// Dashboard buttons: tick a to-do done, dismiss a news item.
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { markActionDone } from "@/lib/rules.mjs";

function refresh() {
  revalidatePath("/");
}

export async function dashboardCompleteAction(id: number) {
  markActionDone(getDb(), id);
  refresh();
  revalidatePath("/actions");
}

export async function dashboardDismissNews(id: number) {
  getDb().prepare(`UPDATE news_items SET dismissed_at=datetime('now') WHERE id=?`).run(id);
  refresh();
  revalidatePath("/news");
}
