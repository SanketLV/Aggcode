import { useState } from "react";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { ICON_STROKE } from "../constants";
import type { ToolPart } from "../types";
import { ToolIcon } from "./ToolIcon";

function StatusIcon({ status }: { status: ToolPart["status"] }) {
  if (status === "running") {
    return (
      <Loader2
        strokeWidth={2}
        role="img"
        aria-label="Running"
        className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
      />
    );
  }
  if (status === "error") {
    return (
      <X
        strokeWidth={2}
        role="img"
        aria-label="Failed"
        className="size-3 shrink-0 text-destructive"
      />
    );
  }
  return (
    <Check
      strokeWidth={2}
      role="img"
      aria-label="Done"
      className="size-3 shrink-0 text-success"
    />
  );
}

export function ToolRow({ part }: { part: ToolPart }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? part.status === "running";
  const hasBody = part.status !== "running";
  const failed = part.status === "error";

  return (
    <div
      className={`overflow-hidden rounded-md border bg-card ${
        failed ? "border-destructive/25" : "border-border"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
        className="focus-ring flex h-8 w-full items-center gap-2 px-2.5 text-left font-mono text-micro text-muted-foreground transition-colors hover:bg-accent/50 motion-reduce:transition-none"
      >
        <ChevronRight
          strokeWidth={ICON_STROKE}
          aria-hidden="true"
          className={`size-3 shrink-0 text-subtle-foreground transition-transform motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
        />
        <ToolIcon name={part.name} />
        <span
          className={`shrink-0 font-medium ${
            failed ? "text-destructive" : "text-foreground/85"
          }`}
        >
          {part.name}
        </span>
        <span className="min-w-0 flex-1 truncate">{part.detail}</span>
        <StatusIcon status={part.status} />
      </button>

      {open && hasBody && (
        <div className="border-t border-border bg-background">
          {part.output ? (
            <pre className="max-h-64 overflow-auto px-3 py-2.5 font-mono text-micro leading-relaxed font-normal whitespace-pre-wrap text-muted-foreground">
              {part.output}
            </pre>
          ) : (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              This tool returned no output.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
