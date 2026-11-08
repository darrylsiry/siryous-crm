import { ignoreInboxMessage, rerouteInboxMessage } from "@/lib/inboxActions";
import ConfirmButton from "@/components/ConfirmButton";

const btn = "rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50";

/**
 * An email's "More ▾" menu: route it again as Log or Intake, or ignore it,
 * with what each does said in the menu. Not offered once every draft from the
 * email is saved, and no "Redo as Log" once its Log draft is saved (either
 * would log it twice); replacing a ready draft asks first.
 */
export default function InboxRedo({
  id,
  status,
  drafts,
  back,
  hasText = true,
  logSaved = false,
}: {
  id: number;
  status: string;
  /** The statuses of the drafts made from this email. */
  drafts: string[];
  /** "message" to come back to the email's own page. */
  back?: "message";
  /** false for ignored mail, which keeps its headers only: there is nothing to route. */
  hasText?: boolean;
  /** Its Log draft is saved: the entries are in the CRM, so it can't be logged again. */
  logSaved?: boolean;
}) {
  const saved = drafts.length > 0 && drafts.every((d) => d === "confirmed");
  if (saved) return null;
  if (!hasText) {
    return (
      <p className="text-xs text-stone-500">
        Its text wasn&apos;t kept (ignored mail keeps only its headers, for 30 days). To record it, forward it again from one of your addresses.
      </p>
    );
  }
  const ready = drafts.some((d) => d === "ready");
  // Ignore discards unsaved drafts and the email's text: it asks first when a draft is waiting or being written.
  const unsaved = drafts.some((d) => d === "ready" || d === "analyzing" || d === "pending");
  const routed = status === "routed";
  const Redo = ({ as, label, what }: { as: "log" | "intake"; label: string; what: string }) => (
    <form action={rerouteInboxMessage} className="flex items-start gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="as" value={as} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      {ready ? (
        <ConfirmButton label={label} confirm={`Replace this email's draft? It discards the one waiting for review and runs the model again.`} className={btn} />
      ) : (
        <button className={btn}>{label}</button>
      )}
      <span className="pt-1 text-xs text-stone-500">{what}</span>
    </form>
  );
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none font-medium text-stone-600 hover:text-indigo-700">
        {routed ? "Wrong guess? More ▾" : "Route it ▾"}
      </summary>
      <div className="mt-2 space-y-2 rounded-lg border border-stone-200 bg-white p-3">
        {logSaved ? null : (
          <Redo
            as="log"
            label={routed ? "Redo as Log" : "Route as Log"}
            what="Draft log entries for the people already in your CRM (one more model run). Its unsaved drafts are discarded."
          />
        )}
        <Redo
          as="intake"
          label={routed ? "Redo as Intake" : "Route as Intake"}
          what={`Draft a new profile for the person it's about (one more model run). Its unsaved drafts are discarded${logSaved ? "; the log entries you saved stay" : ""}.`}
        />
        {status !== "ignored" ? (
          <form action={ignoreInboxMessage} className="flex items-start gap-2">
            <input type="hidden" name="id" value={id} />
            {back ? <input type="hidden" name="back" value={back} /> : null}
            {unsaved ? (
              <ConfirmButton
                label="Ignore"
                confirm="Ignore this email? Its draft waiting for review is discarded and the email's text is deleted from the CRM. To record it later you'd forward it again."
                className={btn}
              />
            ) : (
              <button className={btn}>Ignore</button>
            )}
            <span className="pt-1 text-xs text-stone-500">Leave it out, and discard its drafts that weren&apos;t saved.</span>
          </form>
        ) : null}
      </div>
    </details>
  );
}
