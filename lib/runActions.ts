"use server";

import { revalidatePath } from "next/cache";
import { cancelRun } from "./progress";

/** The Cancel button on a running draft or brief. */
export async function cancelRunAction(kind: "log" | "intake" | "prep", id: number) {
  if (!["log", "intake", "prep"].includes(kind) || !Number.isInteger(id)) return;
  cancelRun(kind, id);
  revalidatePath("/", "layout");
}
