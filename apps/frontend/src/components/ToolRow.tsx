import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { ICON_STROKE } from "../constants";
import type { ToolPart } from "../types";
import { ToolIcon } from "./ToolIcon";

export function ToolRow({ part }: { part: ToolPart }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? part.status === "running";
  const hasBody = part.status !== "running";

  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-card/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
      >
        <ChevronRight
          strokeWidth={ICON_STROKE}
          className={`size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
        />
        <ToolIcon name={part.name} />
        <span
          className={`shrink-0 ${
            part.status === "error" ? "text-destructive" : "text-foreground/80"
          }`}
        >
          {part.name}
        </span>
        {part.detail && (
          <span className="truncate text-muted-foreground">{part.detail}</span>
        )}
        {part.status === "running" && (
          <Loader2
            strokeWidth={ICON_STROKE}
            className="ml-auto size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        )}
      </button>

      {open && hasBody && (
        <div className="border-t border-border/60">
          {part.output ? (
            <pre className="max-h-64 overflow-auto px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
              {part.output}
            </pre>
          ) : (
            <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
              This tool returned no output.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
