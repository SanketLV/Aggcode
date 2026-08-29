import { Loader2 } from "lucide-react";
import { ICON_STROKE } from "../constants";
import type { ToolPart } from "../types";
import { Elapsed } from "./Elapsed";

export function RunIndicator({
  startedAt,
  thinkingTokens,
  activeTool,
}: {
  startedAt: number | undefined;
  thinkingTokens: number | undefined;
  activeTool: ToolPart | undefined;
}) {
  const label = activeTool
    ? [activeTool.name, activeTool.detail].filter(Boolean).join(" ")
    : thinkingTokens && thinkingTokens > 0
      ? `Thinking, ${thinkingTokens.toLocaleString()} tokens`
      : "Working";

  return (
    <div
      className="flex items-center gap-2 px-1 text-xs text-muted-foreground"
      aria-live="polite"
    >
      <Loader2
        strokeWidth={ICON_STROKE}
        className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <span className="truncate">{label}</span>
      {startedAt !== undefined && (
        <span className="shrink-0 tabular-nums">
          <Elapsed since={startedAt} />
        </span>
      )}
    </div>
  );
}
