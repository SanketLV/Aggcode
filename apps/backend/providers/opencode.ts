import { createOpencodeClient } from "@opencode-ai/sdk";
import type { ModelOption } from "commons/types";
import { ensureOpenCodeServer } from "./serverManager";
import type { AgentEvent, AgentProvider, AgentRunParams } from "./types";
import { buildWorkspaceSessionSummary } from "./workspaceContext";

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

export class OpenCodeProvider implements AgentProvider {
  id = "opencode";
  name = "OpenCode";

  async getAvailableModels(): Promise<ModelOption[]> {
    const fallbackModels: ModelOption[] = [
      { id: "opencode/nemotron-3-ultra-free", name: "Nemotron 3 Ultra (Free)" },
      {
        id: "opencode/nemotron-3.5-lightning-free",
        name: "Nemotron 3.5 Lightning (Free)",
      },
      { id: "opencode/mimo-v2.5-free", name: "Mimo v2.5 (Free)" },
      { id: "opencode/big-pickle", name: "Big Pickle" },
    ];

    try {
      const baseUrl = await ensureOpenCodeServer();
      const client = createOpencodeClient({ baseUrl });
      const providers = await client.provider.list();
      if (!providers.data?.all) {
        return fallbackModels;
      }

      const models: ModelOption[] = [];

      // Look for opencode free models and any configured providers
      for (const prov of providers.data.all) {
        if (!prov.models) continue;
        // Prioritize opencode free models, anthropic, openai, deepseek, or other major providers
        const isPriorityProvider = [
          "opencode",
          "anthropic",
          "openai",
          "deepseek",
        ].includes(prov.id);

        if (isPriorityProvider) {
          for (const [mId, mInfo] of Object.entries(prov.models)) {
            models.push({
              id: `${prov.id}/${mId}`,
              name: `${prov.name}: ${mInfo.name || mId}`,
              supportsEffort: mInfo.reasoning === true,
            });
          }
        }
      }

      return models.length > 0 ? models : fallbackModels;
    } catch (err) {
      console.warn(
        "[opencode] Could not fetch remote model list, using defaults:",
        err,
      );
      return fallbackModels;
    }
  }

  async *runAgent({
    prompt,
    cwd,
    workspaceId,
    sessionId,
    resumeId,
    model,
    historyContext,
    signal,
  }: AgentRunParams): AsyncGenerator<AgentEvent, void, unknown> {
    let baseUrl: string;
    try {
      baseUrl = await ensureOpenCodeServer();
    } catch (err) {
      yield {
        type: "error",
        message: `Failed to start or connect to OpenCode server: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
      return;
    }

    const client = createOpencodeClient({
      baseUrl,
    });

    const workspaceSummary = await buildWorkspaceSessionSummary(
      workspaceId,
      sessionId,
    );

    let fullPrompt = prompt;
    if (historyContext || workspaceSummary) {
      const parts: string[] = [];
      if (workspaceSummary) {
        parts.push(workspaceSummary);
      }
      if (historyContext) {
        parts.push(historyContext);
      }
      fullPrompt = `${parts.join("\n\n")}\n\n[USER INSTRUCTION]:\n${prompt}`;
    }

    // Create or resume session.
    let opencodeSessionId: string;

    if (resumeId) {
      try {
        const existing = await client.session.get({ path: { id: resumeId } });
        if (existing.data) {
          opencodeSessionId = existing.data.id;
        } else {
          const created = await client.session.create({
            body: { title: "aggcode session" },
          });
          if (!created.data) {
            throw new Error("Failed to create OpenCode session");
          }
          opencodeSessionId = created.data.id;
        }
      } catch {
        const created = await client.session.create({
          body: { title: "aggcode session" },
        });
        if (!created.data) {
          throw new Error("Failed to create OpenCode session");
        }
        opencodeSessionId = created.data.id;
      }
    } else {
      const created = await client.session.create({
        body: { title: "aggcode session" },
      });
      if (!created.data) {
        throw new Error("Failed to create OpenCode session");
      }
      opencodeSessionId = created.data.id;
    }

    // Subscribe to SSE events BEFORE sending the prompt so we don't miss any.
    const { stream: eventStream } = await client.global.event();

    let modelPayload: { providerID: string; modelID: string } | undefined;
    if (model) {
      if (model.includes("/")) {
        const [provId, mId] = model.split("/");
        if (provId && mId) {
          modelPayload = { providerID: provId, modelID: mId };
        }
      } else {
        modelPayload = { providerID: "opencode", modelID: model };
      }
    }

    // Send prompt (non-blocking — returns immediately, AI runs in background).
    const promptPromise = client.session.prompt({
      path: { id: opencodeSessionId },
      body: {
        parts: [{ type: "text", text: fullPrompt }],
        ...(modelPayload ? { model: modelPayload } : {}),
      },
    });

    let settled = false;

    try {
      for await (const event of eventStream) {
        if (settled) break;
        if (signal?.aborted) {
          yield { type: "error", message: "Agent run cancelled." };
          break;
        }

        const { type } = event.payload;

        // message.part.updated — streaming text delta or tool state change.
        if (type === "message.part.updated") {
          const { part, delta } = event.payload.properties;

          // Text delta — streaming prose.
          if (part.type === "text" && delta) {
            yield { type: "text_delta", text: delta };
            continue;
          }

          // Tool part — state transition signals tool start/result.
          if (part.type === "tool") {
            const toolState = part.state;
            if (toolState.status === "running") {
              yield {
                type: "tool_start",
                toolId: part.callID,
                name: part.tool,
                detail: toolDetail(toolState.input, cwd),
              };
            } else if (toolState.status === "completed") {
              yield {
                type: "tool_result",
                toolId: part.callID,
                status: "done",
                output: toolState.output,
              };
            } else if (toolState.status === "error") {
              yield {
                type: "tool_result",
                toolId: part.callID,
                status: "error",
                output: toolState.error,
              };
            }
            continue;
          }
        }

        // session.status — idle means the run completed.
        if (type === "session.status") {
          const { status } = event.payload.properties;
          if (status.type === "idle") {
            settled = true;
            // Fetch the final assistant message for the complete text.
            const messages = await client.session.messages({
              path: { id: opencodeSessionId },
            });
            const lastAssistant = messages.data
              ?.filter((m) => m.info.role === "assistant")
              .pop();
            const text =
              lastAssistant?.parts
                ?.filter((p) => p.type === "text")
                .map((p) => (p.type === "text" ? p.text : ""))
                .join("") ?? "";
            yield { type: "success", text, sessionId: opencodeSessionId };
            break;
          }
        }

        // session.idle — alternative completion signal.
        if (type === "session.idle") {
          settled = true;
          const messages = await client.session.messages({
            path: { id: opencodeSessionId },
          });
          const lastAssistant = messages.data
            ?.filter((m) => m.info.role === "assistant")
            .pop();
          const text =
            lastAssistant?.parts
              ?.filter((p) => p.type === "text")
              .map((p) => (p.type === "text" ? p.text : ""))
              .join("") ?? "";
          yield { type: "success", text, sessionId: opencodeSessionId };
          break;
        }

        // session.error — explicit error event.
        if (type === "session.error") {
          settled = true;
          const errProps = event.payload.properties.error;
          const message =
            errProps && typeof errProps === "object" && "message" in errProps
              ? String(errProps.message)
              : "OpenCode session error.";
          yield { type: "error", message };
          break;
        }
      }

      await promptPromise;
    } catch (error) {
      if (!settled) {
        settled = true;
        yield {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
}
