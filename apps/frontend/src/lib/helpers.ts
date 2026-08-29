import type { IncomingMessageType, Message, MessagePart } from "commons/types";
import type { UiWorkspace } from "../context/AppContext";

export function send(
  socket: WebSocket | null,
  message: IncomingMessageType,
): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}

export function appendMessage(
  workspaces: UiWorkspace[],
  sessionId: string,
  message: Message,
): UiWorkspace[] {
  return workspaces.map((w) => ({
    ...w,
    sessions: w.sessions.map((s) =>
      s.id === sessionId ? { ...s, messages: [...s.messages, message] } : s,
    ),
  }));
}

export function appendDelta(parts: MessagePart[], text: string): MessagePart[] {
  const last = parts[parts.length - 1];
  if (last?.type === "text") {
    return [...parts.slice(0, -1), { type: "text", text: last.text + text }];
  }
  return [...parts, { type: "text", text }];
}

export function partsOf(message: Message): MessagePart[] {
  return (
    message.payload.parts ?? [{ type: "text", text: message.payload.message }]
  );
}
