import type { MessagePart } from "commons/types";

export type ToolPart = Extract<MessagePart, { type: "tool" }>;
