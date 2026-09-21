import fs from "fs";
import path from "path";
import { createOpencodeClient } from "@opencode-ai/sdk";
// v1 has no provider-credential removal; v2 exposes DELETE /auth/{providerID}.
import { createOpencodeClient as createOpencodeClientV2 } from "@opencode-ai/sdk/v2";
import type { ModelOption } from "commons/types";
import { ProviderConfigModel } from "db/client";
import {
  connectWithOwnership,
  isValidSubProviderId,
  planOpenCodeLogout,
} from "./authScope";
import { ensureOpenCodeServer } from "./serverManager";
import type {
  AgentEvent,
  AgentProvider,
  AgentRunParams,
  AuthProviderPlugin,
  ProviderAuthStatus,
} from "./types";
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

  auth: AuthProviderPlugin = {
    getAuthMethods: () => [
      {
        id: "connect",
        label: "Connect Model Provider (API Key)",
        type: "api_key",
        description:
          "Connect an external AI provider (e.g. openrouter, openai, anthropic, deepseek, google, etc.) to OpenCode.",
        fields: [
          {
            id: "subProvider",
            label: "Provider ID",
            type: "text",
            placeholder: "openrouter / openai / anthropic / deepseek",
            required: true,
            description: "Identifier of the provider to connect.",
          },
          {
            id: "apiKey",
            label: "API Key",
            type: "password",
            placeholder: "Provider API key",
            required: true,
            description: "API Key for the provider.",
          },
        ],
      },
    ],

    getAuthStatus: async (): Promise<ProviderAuthStatus> => {
      try {
        const baseUrl = await ensureOpenCodeServer();
        const client = createOpencodeClient({ baseUrl });
        const provList = await client.provider.list();
        const connected = provList.data?.connected || [];

        const home = process.env.USERPROFILE || process.env.HOME || "";
        const authPath = path.join(
          home,
          ".local",
          "share",
          "opencode",
          "auth.json",
        );
        let extraProviders: string[] = [];
        if (fs.existsSync(authPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"));
            extraProviders = Object.keys(parsed);
          } catch (err) {
            console.warn(`[opencode auth] Unreadable ${authPath}:`, err);
          }
        }
        const allConnected = Array.from(
          new Set([...connected, ...extraProviders]),
        );

        // Gated: chat is disabled when no external provider is connected,
        // even though free models exist. The built-in "opencode" provider
        // itself does not count as signed in.
        const externalConnected = allConnected.filter(
          (id) => id.toLowerCase() !== "opencode",
        );
        const isAuthenticated = externalConnected.length > 0;

        return {
          providerId: "opencode",
          isAuthenticated,
          method: isAuthenticated ? "api_key" : "none",
          accountName: isAuthenticated
            ? externalConnected.join(", ")
            : "Not signed in",
          details: isAuthenticated
            ? `Connected ${externalConnected.length} provider${externalConnected.length === 1 ? "" : "s"}: ${externalConnected.join(", ")}`
            : "Not signed in. Connect a provider to enable chat. Free models are disabled when signed out.",
          connectedSubProviders: externalConnected,
        };
      } catch (err) {
        return {
          providerId: "opencode",
          isAuthenticated: false,
          method: "none",
          details: `OpenCode server offline: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    },

    login: async ({
      method,
      credentials,
    }): Promise<{ success: boolean; message?: string }> => {
      if (method === "connect") {
        const subProvider = credentials?.subProvider?.trim().toLowerCase();
        const apiKey = credentials?.apiKey?.trim();

        if (!subProvider || !apiKey) {
          return {
            success: false,
            message: "Provider name and API key are required.",
          };
        }
        if (!isValidSubProviderId(subProvider)) {
          return {
            success: false,
            message: `'${subProvider}' is not a valid provider id. Use letters, digits, '-' or '_'.`,
          };
        }

        let baseUrl: string;
        try {
          baseUrl = await ensureOpenCodeServer();
        } catch (err) {
          return {
            success: false,
            message: `OpenCode server is not available: ${
              err instanceof Error ? err.message : String(err)
            }`,
          };
        }

        const result = await connectWithOwnership({
          setKey: async () => {
            const res = await createOpencodeClient({ baseUrl }).auth.set({
              path: { id: subProvider },
              body: { type: "api", key: apiKey },
            });
            if (res.error) {
              throw new Error(JSON.stringify(res.error));
            }
          },
          // Record that Aggcode made this connection, so sign-out can remove
          // it without touching providers connected through the opencode CLI.
          recordOwner: async () => {
            await ProviderConfigModel.findOneAndUpdate(
              { providerId: "opencode" },
              {
                $set: {
                  [`credentials.${subProvider}`]: "connected-by-aggcode",
                  updatedAt: new Date(),
                },
              },
              { upsert: true },
            );
          },
          removeKey: async () => {
            const res = await createOpencodeClientV2({ baseUrl }).auth.remove({
              providerID: subProvider,
            });
            if (res.error) {
              throw new Error(JSON.stringify(res.error));
            }
          },
        });

        if (result.ok) {
          return {
            success: true,
            message: `Successfully connected ${subProvider} to OpenCode.`,
          };
        }
        switch (result.reason) {
          case "set-failed":
            return {
              success: false,
              message: `OpenCode rejected the credentials for ${subProvider}: ${result.error}`,
            };
          case "rolled-back":
            return {
              success: false,
              message: `Could not save the connection (${result.error}), so ${subProvider} was disconnected again. Try again.`,
            };
          case "orphaned":
            return {
              success: false,
              message: `Could not save the connection (${result.error}), and ${subProvider} is still connected in OpenCode. Run \`opencode auth logout\` in a terminal to remove it.`,
            };
        }
      }

      return { success: false, message: `Unsupported method: ${method}` };
    },

    // OpenCode's credential store is machine-wide and shared with the
    // `opencode` CLI, so only providers Aggcode connected are removed, and only
    // through OpenCode's own API rather than by editing auth.json.
    logout: async (params): Promise<{ success: boolean; message?: string }> => {
      const config = await ProviderConfigModel.findOne({
        providerId: "opencode",
      });
      const appConnected = Array.from(config?.credentials?.keys() ?? []);
      const { remove, notOwned } = planOpenCodeLogout(
        appConnected,
        params?.target,
      );

      if (notOwned.length > 0) {
        return {
          success: false,
          message: `${notOwned.join(", ")} was connected outside Aggcode, so Aggcode leaves it alone. Run \`opencode auth logout\` in a terminal to remove it.`,
        };
      }
      if (remove.length === 0) {
        return {
          success: true,
          message: "Aggcode has not connected any providers to OpenCode.",
        };
      }

      const baseUrl = await ensureOpenCodeServer();
      const client = createOpencodeClientV2({ baseUrl });
      const removed: string[] = [];
      const failed: string[] = [];
      for (const id of remove) {
        const res = await client.auth.remove({ providerID: id });
        if (res.error) {
          console.warn(`[opencode auth] Failed to remove ${id}:`, res.error);
          failed.push(id);
          continue;
        }
        await ProviderConfigModel.updateOne(
          { providerId: "opencode" },
          { $unset: { [`credentials.${id}`]: "" } },
        );
        removed.push(id);
      }

      if (failed.length > 0) {
        return {
          success: false,
          message: `Could not disconnect ${failed.join(", ")} from OpenCode.${
            removed.length > 0 ? ` Disconnected ${removed.join(", ")}.` : ""
          }`,
        };
      }
      return {
        success: true,
        message: `Disconnected ${removed.join(", ")} from OpenCode.`,
      };
    },
  };

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
