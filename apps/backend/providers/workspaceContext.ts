import type { Message } from "commons/types";
import { SessionModel } from "db/client";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

type MinimalMessage = {
  role: string;
  payload?: {
    message?: string | null;
    parts?: Array<{
      type: string;
      name?: string | null;
      detail?: string | null;
    }> | null;
  } | null;
};

export function buildHandoffTranscript(messages: MinimalMessage[]): string {
  if (!messages || messages.length === 0) {
    return "";
  }

  const lines: string[] = [
    "=== PREVIOUS CONVERSATION IN THIS SESSION (HANDOFF FROM EARLIER TURNS) ===",
    "Note: Earlier messages in this session were handled previously. You are continuing this exact conversation in this workspace. Here is the full context of prior turns:",
  ];

  for (const m of messages) {
    const text = m.payload?.message ?? "";
    if (m.role === "user") {
      lines.push(`\n[User]: ${text}`);
    } else if (m.role === "assistant") {
      lines.push(`\n[Assistant]: ${text}`);
      if (m.payload?.parts && m.payload.parts.length > 0) {
        const tools = m.payload.parts
          .filter((p) => p.type === "tool")
          .map((p) => `${p.name || "Tool"}(${p.detail || ""})`);
        if (tools.length > 0) {
          lines.push(`  [Tools used: ${tools.join(", ")}]`);
        }
      }
    }
  }

  lines.push("\n=== END OF PREVIOUS CONVERSATION ===");
  return lines.join("\n");
}

export async function buildWorkspaceSessionSummary(
  workspaceId: string,
  currentSessionId: string,
): Promise<string> {
  try {
    const otherSessions = await SessionModel.find({
      workspace: workspaceId,
      _id: { $ne: currentSessionId },
    });

    if (!otherSessions || otherSessions.length === 0) {
      return "";
    }

    const items = otherSessions.map((s) => {
      const msgs = s.messages || [];
      const firstUserMsg =
        msgs.find((m) => m.role === "user")?.payload?.message ??
        "Empty session";
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const lastSummary = lastMsg?.payload?.message
        ? lastMsg.payload.message.length > 120
          ? lastMsg.payload.message.slice(0, 117) + "..."
          : lastMsg.payload.message
        : "No messages yet";

      return `- Session "${firstUserMsg.slice(0, 50).replace(/\n/g, " ")}" (ID: ${s._id.toString()}, Provider: ${s.provider || "claude"}, Model: ${s.model || "default"}):
    Latest turn: "${lastSummary.replace(/\n/g, " ")}"`;
    });

    return [
      "\n[WORKSPACE MULTI-SESSION CONTEXT]",
      "The following other sessions exist in this same workspace codebase:",
      ...items,
      "You share the exact same workspace filesystem. If the user asks what another session is doing or tells you to follow up on their work, use this context or inspect that session.",
      "",
    ].join("\n");
  } catch (err) {
    console.error("Failed to build workspace session summary:", err);
    return "";
  }
}

export async function getSessionTranscript(sessionId: string): Promise<string> {
  try {
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return `Session ${sessionId} not found.`;
    }

    const msgs = session.messages || [];
    if (msgs.length === 0) {
      return `Session ${sessionId} has no messages.`;
    }

    return msgs
      .map(
        (m) =>
          `[${m.role.toUpperCase()}]: ${m.payload?.message ?? ""}${
            m.payload?.parts
              ? "\n" +
                m.payload.parts
                  .filter((p) => p.type === "tool")
                  .map((p) => `  (Tool ${p.name || "Tool"}: ${p.detail || ""})`)
                  .join("\n")
              : ""
          }`,
      )
      .join("\n\n");
  } catch (err) {
    return `Error retrieving session transcript: ${err}`;
  }
}

export function createWorkspaceMcpServer(
  workspaceId: string,
  currentSessionId: string,
) {
  return createSdkMcpServer({
    name: "aggcode_workspace",
    alwaysLoad: true,
    tools: [
      tool(
        "list_workspace_sessions",
        "Lists all other sessions in the current workspace, their IDs, active providers, and latest turn status.",
        {},
        async () => {
          const summary = await buildWorkspaceSessionSummary(
            workspaceId,
            currentSessionId,
          );
          return {
            content: [
              {
                type: "text",
                text: summary || "No other sessions in this workspace.",
              },
            ],
          };
        },
      ),
      tool(
        "get_workspace_session_transcript",
        "Retrieves the detailed message transcript and tool actions of another session in this workspace by sessionId.",
        {
          sessionId: z.string().describe("The ID of the session to inspect"),
        },
        async ({ sessionId }) => {
          const transcript = await getSessionTranscript(String(sessionId));
          return {
            content: [{ type: "text", text: transcript }],
          };
        },
      ),
    ],
  });
}
