import { getAiStatus, routeUsable } from "@/lib/aiStatus";
import { modelListed } from "@/lib/llm";
import type { Provider } from "@/lib/settings";

/**
 * The privacy line under an AI form, worded from what would happen right now
 * (not from a fixed promise): on this Mac, on Claude by choice, or on Claude
 * because the AI on this Mac is down. `extra` is appended to the on-Mac line
 * ("unless you tick the web box above").
 */
export default async function AiWhereLine({
  extra = "",
  route,
  className = "text-xs text-stone-500",
}: {
  extra?: string;
  route?: { provider: Provider; model: string };
  className?: string;
}) {
  const s = await getAiStatus();
  const provider = route?.provider ?? s.provider;
  const usable = route ? routeUsable(s, route) : s.aiUsable;
  if (!usable) return null;
  const model = route?.model ?? s.model.name;
  const localOk = s.ollama.ok && modelListed(s.model.available.map((m) => m.name), model);
  if (provider === "claude") {
    return <p className={className}>Runs on Claude: what you enter here goes to Anthropic. You can change this in Settings.</p>;
  }
  if (!localOk) {
    return (
      <p className={`${className} font-medium text-amber-800`}>
        The AI on this Mac isn&apos;t running, so this would run on Claude: the text and your contact list go to Anthropic.
      </p>
    );
  }
  return (
    <p className={className}>
      Runs on this Mac ({model}). Nothing leaves your computer{extra}.
    </p>
  );
}
