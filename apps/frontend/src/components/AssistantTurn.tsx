import type { MessagePart } from "commons/types";
import { Streamdown } from "streamdown";
import type { ToolPart } from "../types";
import { ToolRow } from "./ToolRow";

type Block =
  { kind: "text"; text: string } | { kind: "tools"; tools: ToolPart[] };

// A burst of tool calls reads as one step, so consecutive tool parts share a
// tighter group instead of the gap that separates prose from tools.
function toBlocks(parts: MessagePart[]): Block[] {
  const blocks: Block[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      blocks.push({ kind: "text", text: part.text });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last?.kind === "tools") {
      last.tools.push(part);
    } else {
      blocks.push({ kind: "tools", tools: [part] });
    }
  }
  return blocks;
}

export function AssistantTurn({ parts }: { parts: MessagePart[] }) {
  return (
    <div className="flex w-full flex-col gap-3">
      {toBlocks(parts).map((block, index) =>
        block.kind === "text" ? (
          <div key={index} className="transcript-prose text-sm text-foreground">
            <Streamdown>{block.text}</Streamdown>
          </div>
        ) : (
          <div key={index} className="flex flex-col gap-1">
            {block.tools.map((part, toolIndex) => (
              <ToolRow key={toolIndex} part={part} />
            ))}
          </div>
        ),
      )}
    </div>
  );
}
