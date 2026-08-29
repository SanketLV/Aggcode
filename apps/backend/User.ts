import {
  AddMessageSchema,
  CreateSessionSchema,
  CreateWorkspaceSchema,
  type IncomingMessageType,
  type Message,
  type MessagePart,
  type OutgoingMessageType,
} from "commons/types";
import { SessionModel, WorkspaceModel } from "db/client";
import mongoose from "mongoose";
import { WebSocket } from "ws";
import { query, type SDKResultError } from "@anthropic-ai/claude-agent-sdk";

// Workspace paths arrive in whatever form the OS uses, so split on both separators.
function workspaceNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

// Exhaustive by construction: a new SDK error subtype breaks the typecheck
// instead of reaching the UI as a blank reply.
const RESULT_ERROR_LABEL: Record<SDKResultError["subtype"], string> = {
  error_during_execution: "The agent stopped partway through the run.",
  error_max_turns: "The agent hit its turn limit before finishing.",
  error_max_budget_usd: "The agent hit its cost limit before finishing.",
  error_max_structured_output_retries:
    "The agent could not produce a valid structured result.",
};

// Guards against two runs racing on one session: they would clobber each
// other's `anthropicSessionId` and interleave their message writes. Process
// wide, so a second browser tab cannot bypass it either.
const activeRuns = new Set<string>();

// Tool inputs are free-form JSON, so pick the field that best identifies the
// target. Ordered by how specific it is.
const TOOL_DETAIL_KEYS = [
  "file_path",
  "path",
  "pattern",
  "command",
  "url",
  "query",
];

const MAX_TOOL_DETAIL = 80;

// Tool output can be a whole file. Cap it so a transcript cannot bloat the
// session document without bound.
const MAX_TOOL_OUTPUT = 2000;

type ToolResultLike = {
  toolId: string;
  output: string;
  isError: boolean;
};

// The SDK's declared peer `@anthropic-ai/sdk` is not installed, so
// `MessageParam` is unresolved and these blocks arrive effectively untyped.
// Everything below narrows at runtime rather than trusting the compiler.
function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (typeof block !== "object" || block === null) {
        return "";
      }
      const record = block as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .filter((text) => text !== "")
    .join("\n");
}

function extractToolResults(content: unknown): ToolResultLike[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const results: ToolResultLike[] = [];

  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }
    const record = block as Record<string, unknown>;
    if (
      record.type !== "tool_result" ||
      typeof record.tool_use_id !== "string"
    ) {
      continue;
    }

    const output = toolResultText(record.content).trim();

    results.push({
      toolId: record.tool_use_id,
      output:
        output.length > MAX_TOOL_OUTPUT
          ? output.slice(0, MAX_TOOL_OUTPUT) + "\n... output truncated"
          : output,
      isError: record.is_error === true,
    });
  }

  return results;
}

function toolDetail(input: unknown, cwd: string): string {
  if (typeof input !== "object" || input === null) {
    return "";
  }

  const record = input as Record<string, unknown>;

  for (const key of TOOL_DETAIL_KEYS) {
    const value = record[key];
    if (typeof value !== "string" || value === "") {
      continue;
    }

    // Absolute paths inside the workspace read better as relative ones.
    let detail = value;
    if (detail.toLowerCase().startsWith(cwd.toLowerCase())) {
      detail = detail.slice(cwd.length).replace(/^[\\/]+/, "");
    }

    return detail.length > MAX_TOOL_DETAIL
      ? detail.slice(0, MAX_TOOL_DETAIL - 3) + "..."
      : detail;
  }

  return "";
}

export class User {
  private socket: WebSocket;
  public id: string;

  constructor(id: string, socket: WebSocket) {
    this.socket = socket;
    this.id = id;
  }

  // Not async: an agent run sends several frames, and a rejected promise from a
  // socket that closed mid-run would surface as an unhandled rejection.
  sendMessage(payload: OutgoingMessageType): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  // Returns null when the branch has already sent its own frames.
  async handleIncomingMessage(
    msg: IncomingMessageType,
  ): Promise<OutgoingMessageType | null> {
    if (msg.type === "create-workspace") {
      const parsed = CreateWorkspaceSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("create-workspace: invalid payload");
      }

      const { path } = parsed.data;
      const name = workspaceNameFromPath(path);
      const workspace = await WorkspaceModel.create({ path, name });

      return {
        type: "workspace-created",
        payload: {
          id: workspace._id.toString(),
          path,
          name,
        },
      };
    }

    if (msg.type === "create-session") {
      const parsed = CreateSessionSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("create-session: invalid payload");
      }

      const { workspaceId } = parsed.data;

      if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
        throw new Error("create-session: unknown workspace");
      }

      const workspace = await WorkspaceModel.findById(workspaceId);

      if (!workspace) {
        throw new Error("create-session: unknown workspace");
      }

      const session = await SessionModel.create({
        workspace: workspace._id,
        messages: [],
      });

      return {
        type: "session-created",
        payload: {
          id: session._id.toString(),
          workspaceId,
        },
      };
    }

    if (msg.type === "add-message") {
      const parsed = AddMessageSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("add-message: invalid payload");
      }

      const { sessionId, message } = parsed.data;

      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        throw new Error("add-message: unknown session");
      }

      const stored: Message = {
        role: "user",
        payload: { message },
      };

      // Rejections below are reported as `assistant-error` rather than thrown:
      // a throw is only logged by UserManager, leaving the client with no idea
      // why its message vanished.
      const reject = (reason: string): null => {
        this.sendMessage({
          type: "assistant-error",
          payload: { sessionId, message: reason },
        });
        return null;
      };

      const session = await SessionModel.findById(sessionId);

      if (!session) {
        return reject("This session no longer exists. Reload the page.");
      }

      const workspace = await WorkspaceModel.findById(session.workspace);

      // Never fall through to the backend's own cwd: the agent runs with
      // `acceptEdits` and `Edit` allowed, so an unresolved workspace would let
      // it rewrite this repo instead of the user's project.
      if (!workspace?.path) {
        return reject(
          "This session has no workspace folder, so the agent cannot run.",
        );
      }

      if (activeRuns.has(sessionId)) {
        return reject(
          "This session is already running. Wait for it to finish.",
        );
      }

      await SessionModel.updateOne(
        { _id: session._id },
        { $push: { messages: stored } },
      );

      // Echo the user's own message before the run starts, so it renders
      // immediately and always above whatever the agent produces.
      this.sendMessage({
        type: "message-added",
        payload: { sessionId, message: stored },
      });

      await this.runAgent(sessionId, workspace.path, message);
      return null;
    }

    throw new Error("Incorrect input schema");
  }

  private async runAgent(
    sessionId: string,
    cwd: string,
    prompt: string,
  ): Promise<void> {
    activeRuns.add(sessionId);
    this.sendMessage({ type: "assistant-working", payload: { sessionId } });

    let settled = false;

    // Accumulated live transcript. Streamed to the client frame by frame and
    // persisted once, at settle, so the reload matches what the user watched.
    const parts: MessagePart[] = [];

    const pushText = (chunk: string): void => {
      const last = parts[parts.length - 1];
      if (last?.type === "text") {
        last.text += chunk;
      } else {
        parts.push({ type: "text", text: chunk });
      }
      this.sendMessage({
        type: "assistant-delta",
        payload: { sessionId, text: chunk },
      });
    };

    const pushTool = (toolId: string, name: string, detail: string): void => {
      parts.push({ type: "tool", toolId, name, detail, status: "running" });
      this.sendMessage({
        type: "assistant-tool",
        payload: { sessionId, toolId, name, detail },
      });
    };

    const resolveTool = (result: ToolResultLike): void => {
      const part = parts.find(
        (candidate) =>
          candidate.type === "tool" && candidate.toolId === result.toolId,
      );

      // A result for a tool_use we never saw has nothing to attach to.
      if (!part || part.type !== "tool") {
        return;
      }

      const status = result.isError ? "error" : "done";
      part.status = status;
      part.output = result.output;

      this.sendMessage({
        type: "assistant-tool-result",
        payload: {
          sessionId,
          toolId: result.toolId,
          status,
          output: result.output,
        },
      });
    };

    const settle = async (text: string, isError: boolean): Promise<void> => {
      if (settled) {
        return;
      }
      settled = true;

      if (isError) {
        // Failures are not part of the conversation, so they are not stored:
        // persisting them would feed the error back as context on the next
        // `resume`, and the true record is a user message with no reply.
        this.sendMessage({
          type: "assistant-error",
          payload: { sessionId, message: text },
        });
        return;
      }

      // Safety net: if no text ever streamed (partial messages unavailable, or
      // a run that only called tools), the final answer would otherwise be
      // missing from the transcript entirely.
      if (!parts.some((part) => part.type === "text")) {
        parts.push({ type: "text", text });
      }

      // The turn is over, so nothing can still be running. Without this a tool
      // whose result never arrived would spin forever in the transcript.
      for (const part of parts) {
        if (part.type === "tool" && part.status === "running") {
          part.status = "done";
        }
      }

      const assistant: Message = {
        role: "assistant",
        payload: { message: text, parts },
      };

      // Persist before sending: a socket that dropped mid-run costs the live
      // update, never the data.
      await SessionModel.updateOne(
        { _id: sessionId },
        { $push: { messages: assistant } },
      );

      this.sendMessage({
        type: "assistant-message",
        payload: { sessionId, message: assistant },
      });
    };

    try {
      const session = await SessionModel.findById(sessionId);
      const resume = session?.anthropicSessionId ?? undefined;

      for await (const message of query({
        prompt,
        options: {
          cwd,
          allowedTools: ["Read", "Edit", "Glob"],
          resume,
          permissionMode: "acceptEdits",
          // Emits `stream_event` frames carrying raw Messages API deltas, which
          // is what makes the prose appear as it is written.
          includePartialMessages: true,
        },
      })) {
        // Prose arrives here, token by token.
        if (message.type === "stream_event") {
          const { event } = message;
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            pushText(event.delta.text);
          }
          continue;
        }

        // Completed blocks arrive here. Text is skipped because the deltas
        // above already carried it; only tool calls are new information.
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use") {
              pushTool(block.id, block.name, toolDetail(block.input, cwd));
            }
          }
          continue;
        }

        // The CLI emits user-role messages for content it adds itself, which is
        // chiefly the tool_result blocks answering the tool_use blocks above.
        if (message.type === "user") {
          for (const result of extractToolResults(message.message.content)) {
            resolveTool(result);
          }
          continue;
        }

        // Live thinking-token estimate. The SDK documents this as intended for
        // exactly this kind of progress indicator.
        if (
          message.type === "system" &&
          message.subtype === "thinking_tokens"
        ) {
          this.sendMessage({
            type: "assistant-progress",
            payload: { sessionId, thinkingTokens: message.estimated_tokens },
          });
          continue;
        }

        if (message.type !== "result") {
          continue;
        }

        // `field: null` matches both an explicit null and an absent field, so
        // the first result to arrive claims the id and later ones no-op.
        await SessionModel.updateOne(
          { _id: sessionId, anthropicSessionId: null },
          { $set: { anthropicSessionId: message.session_id } },
        );

        if (message.subtype === "success") {
          const text = message.result.trim();

          if (message.is_error) {
            await settle(text || "The agent stopped on an error.", true);
          } else if (text === "") {
            // An empty string would render a blank bubble and fail the
            // schema's `required` on payload.message, losing the row.
            await settle("The agent finished without producing a reply.", true);
          } else {
            await settle(message.result, false);
          }
        } else {
          await settle(
            message.errors.length > 0
              ? message.errors.join("\n")
              : RESULT_ERROR_LABEL[message.subtype],
            true,
          );
        }
      }
    } catch (error) {
      console.error("Agent run failed for session " + sessionId, error);
      await settle(
        error instanceof Error ? error.message : String(error),
        true,
      );
    } finally {
      // The client clears its working indicator only on a terminal frame, so
      // one must go out on every path.
      if (!settled) {
        await settle("The agent exited without returning a result.", true);
      }
      activeRuns.delete(sessionId);
    }
  }
}
