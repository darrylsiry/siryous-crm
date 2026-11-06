"use client";

import { useOptimistic, useState } from "react";
import PendingButton from "./PendingButton";

type Busy = { kind: "send"; message: string } | { kind: "end" } | null;
type Action = (formData: FormData) => Promise<{ ok: boolean }>;

/**
 * The chat + end-session forms for a live coach session. While either form
 * is pending the typed message shows as a bubble (useOptimistic — it clears
 * itself when the server's fresh transcript arrives) and both submit buttons
 * are disabled, so a double-click or a Send racing an End can't happen from
 * this page. The server holds its own lock too (coach_sessions.in_flight).
 */
export default function CoachChat({
  sessionId,
  error,
  sendAction,
  endAction,
  pendingProposals = 0,
}: {
  sessionId: number;
  error: string | null;
  sendAction: Action;
  endAction: Action;
  /** Proposals not yet ticked or rejected: End session says so before closing. */
  pendingProposals?: number;
}) {
  const [busy, setBusy] = useOptimistic<Busy>(null);
  const [text, setText] = useState("");

  const send = async (formData: FormData) => {
    const message = String(formData.get("message") ?? "").trim();
    if (message.length < 2) return;
    setBusy({ kind: "send", message });
    const result = await sendAction(formData);
    // On success the reply is now in the transcript; on failure keep the
    // text in the box so it can be sent again (the server saved nothing).
    if (result?.ok) setText("");
  };

  const end = async (formData: FormData) => {
    setBusy({ kind: "end" });
    await endAction(formData);
  };

  const disabled = busy !== null;

  return (
    <>
      {busy?.kind === "send" ? (
        <ul className="mt-3">
          <li className="ml-8 rounded-xl rounded-tr-sm border border-stone-200 bg-stone-50 p-4 opacity-70">
            <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-stone-500">You · sending…</p>
            <p className="whitespace-pre-line text-sm">{busy.message}</p>
          </li>
        </ul>
      ) : null}
      {error && !disabled ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>
      ) : null}
      <form action={send} className="mt-4 space-y-2">
        <fieldset disabled={disabled} className="space-y-2">
          <input type="hidden" name="session_id" value={sessionId} />
          <textarea
            name="message"
            required
            minLength={2}
            rows={3}
            placeholder="Reply to your coach…"
            value={busy?.kind === "send" ? "" : text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-xl border border-stone-300 p-3 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none disabled:bg-stone-50"
          />
          <PendingButton label="Send" pendingLabel="Coach is thinking…" pendingNote="A reply can take a minute or two on this Mac." />
        </fieldset>
      </form>
      <form
        action={end}
        onSubmit={(e) => {
          const msg =
            `End this session for good? The coach writes the summary and your commitments, and you can't reply after.` +
            (pendingProposals ? `\n\n${pendingProposals} proposed CRM change${pendingProposals === 1 ? " is" : "s are"} still waiting for your tick.` : "");
          if (!window.confirm(msg)) e.preventDefault();
        }}
        className="mt-4 border-t border-stone-100 pt-4"
      >
        <fieldset disabled={disabled}>
          <input type="hidden" name="session_id" value={sessionId} />
          <PendingButton
            label="End session…"
            pendingLabel="Summarizing the session…"
            pendingNote="The coach is writing up what was discussed and your commitments."
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
          />
        </fieldset>
        <p className="mt-2 text-xs text-stone-500">
          Closes the session for good. The summary and commitments carry into next week's session; any CRM changes it proposes wait for your tick.
        </p>
      </form>
    </>
  );
}
