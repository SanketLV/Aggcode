import type { MessagePart } from "commons/types";
import { Streamdown } from "streamdown";
import { ToolRow } from "./ToolRow";

export function AssistantTurn({ parts }: { parts: MessagePart[] }) {
  return (
    <div className="flex w-full flex-col gap-2">
      {parts.map((part, index) =>
        part.type === "text" ? (
          <div key={index} className="transcript-prose text-sm text-foreground">
            <Streamdown>{part.text}</Streamdown>
          </div>
        ) : (
          <ToolRow key={index} part={part} />
        ),
      )}
    </div>
  );
}
