"use server";

// Dashboard buttons: dismiss a news item. (To-dos are ticked with components/DoneTick.tsx.)
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { setSetting } from "@/lib/settings";

export async function dashboardDismissNews(id: number) {
  getDb().prepare(`UPDATE news_items SET dismissed_at=datetime('now') WHERE id=?`).run(id);
  revalidatePath("/");
  revalidatePath("/news");
}

/** Hide the Dashboard's getting-started checklist for good. */
export async function hideSetupChecklist() {
  setSetting("setup.checklist_hidden", "1");
  revalidatePath("/");
}
