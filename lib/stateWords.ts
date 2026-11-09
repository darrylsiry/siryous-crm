/**
 * One word per state, on every screen: a draft, a brief or an email is
 * Drafting, Ready to review, Failed, Saved or Discarded, never "analyzing",
 * "[ready]" or "see why" on one page and something else on the next.
 */
export type StateWord = "Drafting" | "Ready to review" | "Failed" | "Saved" | "Discarded" | "Not routed" | "Not read yet";

/** A stored draft, brief or coach-session status as the word the owner sees. */
export function stateWord(status: string | null | undefined): StateWord {
  switch (status) {
    case "ready":
      return "Ready to review";
    case "error":
      return "Failed";
    case "confirmed":
    case "closed":
    case "applied":
      return "Saved";
    case "discarded":
    case "rejected":
    case "ignored":
      return "Discarded";
    default:
      // pending, analyzing, confirming, working…
      return "Drafting";
  }
}

/** Tailwind classes for a state word's colour. */
export function stateTone(word: StateWord): string {
  switch (word) {
    case "Ready to review":
      return "font-medium text-green-700";
    case "Failed":
      return "font-medium text-red-700";
    case "Saved":
      return "text-stone-600";
    case "Discarded":
    case "Not routed":
      return "text-stone-500";
    default:
      return "text-amber-700";
  }
}

/** An open Inbox item's state (lib/inbox.ts openInboxItems) as its word. */
export function inboxStateLabel(state: "ready" | "error" | "working" | "unrouted" | "held"): StateWord {
  return state === "unrouted" ? "Not routed" : state === "held" ? "Not read yet" : stateWord(state);
}
