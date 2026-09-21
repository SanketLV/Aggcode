import { exec, spawn } from "child_process";
import mongoose from "mongoose";
import { ProviderConfigModel } from "db/client";
import { query, type SDKResultError } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentEvent,
  AgentProvider,
  AgentRunParams,
  AuthProviderPlugin,
  ProviderAuthStatus,
} from "./types";
import {
  buildWorkspaceSessionSummary,
  createWorkspaceMcpServer,
} from "./workspaceContext";
import { memoizeAsync } from "./authScope";
import {
  decryptSecret,
  encryptSecret,
  loadOrCreateKey,
} from "./credentialCipher";

async function readStoredApiKey(): Promise<string | undefined> {
  const config = await ProviderConfigModel.findOne({ providerId: "claude" });
  const stored = config?.credentials?.get("apiKey");
  return stored ? decryptSecret(stored, loadOrCreateKey()) : undefined;
}

// `claude auth status` takes ~2s on its own and far longer while the OpenCode
// server is starting beside it, so a tight timeout reported a signed-in user as
// signed out and blocked chat.
const CLI_STATUS_TIMEOUT_MS = 15_000;
const CLI_STATUS_TTL_MS = 30_000;

async function readCliAuthStatus(): Promise<ProviderAuthStatus> {
  const result = await new Promise<{ stdout: string; timedOut: boolean }>(
    (resolve) => {
      exec(
        "claude auth status --json",
        { timeout: CLI_STATUS_TIMEOUT_MS },
        (error, stdout) => {
          if (error) {
            console.warn(
              "[claude auth] CLI status check failed:",
              error.message,
            );
            resolve({ stdout: "", timedOut: error.killed === true });
          } else {
            resolve({ stdout: String(stdout), timedOut: false });
          }
        },
      );
    },
  );

  if (result.timedOut) {
    return {
      providerId: "claude",
      isAuthenticated: false,
      method: "none",
      details:
        "Could not confirm the Claude CLI sign-in: the status check timed out.",
    };
  }

  if (result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed.loggedIn) {
        const org = parsed.orgName
          ? ` (${parsed.orgName} - ${parsed.subscriptionType || "subscription"})`
          : "";
        return {
          providerId: "claude",
          isAuthenticated: true,
          method: parsed.authMethod || "oauth",
          accountName: parsed.email || "Claude Subscription",
          details: parsed.email
            ? `${parsed.email}${org}`
            : "Logged in to Claude.ai",
        };
      }
    } catch (err) {
      console.warn("[claude auth] Unreadable CLI status output:", err);
    }
  }

  return {
    providerId: "claude",
    isAuthenticated: false,
    method: "none",
    details: "Not signed in",
  };
}

// Only a signed-in result is cached, so finishing a browser login shows up on
// the next check instead of after the TTL.
const cliAuthStatus = memoizeAsync(readCliAuthStatus, {
  ttlMs: CLI_STATUS_TTL_MS,
  shouldCache: (status) => status.isAuthenticated,
});

// Exhaustive by construction: a new SDK error subtype breaks the typecheck
// instead of reaching the UI as a blank reply.
const RESULT_ERROR_LABEL: Record<SDKResultError["subtype"], string> = {
  error_during_execution: "The agent stopped partway through the run.",
  error_max_turns: "The agent hit its turn limit before finishing.",
  error_max_budget_usd: "The agent hit its cost limit before finishing.",
  error_max_structured_output_retries:
    "The agent could not produce a valid structured result.",
};

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

export class ClaudeProvider implements AgentProvider {
  id = "claude";
  name = "Claude Code";

  auth: AuthProviderPlugin = {
    getAuthMethods: () => [
      {
        id: "oauth",
        label: "Sign in with Claude.ai (Browser)",
        type: "oauth",
        description:
          "Log in to your Anthropic Claude Pro / Team subscription via your web browser.",
      },
      {
        id: "api_key",
        label: "Anthropic API Key",
        type: "api_key",
        description: "Authenticate directly with your Anthropic API key.",
        fields: [
          {
            id: "apiKey",
            label: "API Key",
            type: "password",
            placeholder: "sk-ant-api03-...",
            required: true,
            description: "Anthropic API console key.",
          },
        ],
      },
    ],

    getAuthStatus: async (): Promise<ProviderAuthStatus> => {
      // 1. Check if DB has stored an API key
      if (mongoose.connection.readyState === 1) {
        try {
          const storedKey =
            (await readStoredApiKey()) || process.env.ANTHROPIC_API_KEY;
          if (storedKey) {
            const masked =
              storedKey.length > 8
                ? `${storedKey.slice(0, 7)}...${storedKey.slice(-4)}`
                : "configured";
            return {
              providerId: "claude",
              isAuthenticated: true,
              method: "api_key",
              accountName: "Anthropic API Key",
              details: `API Key: ${masked}`,
            };
          }
        } catch (err) {
          console.warn("[claude auth] Failed to check db config:", err);
        }
      } else if (process.env.ANTHROPIC_API_KEY) {
        const storedKey = process.env.ANTHROPIC_API_KEY;
        const masked =
          storedKey.length > 8
            ? `${storedKey.slice(0, 7)}...${storedKey.slice(-4)}`
            : "configured";
        return {
          providerId: "claude",
          isAuthenticated: true,
          method: "api_key",
          accountName: "Anthropic API Key",
          details: `API Key: ${masked}`,
        };
      }

      // 2. Check CLI auth status
      return cliAuthStatus.get();
    },

    login: async ({
      method,
      credentials,
    }): Promise<{ success: boolean; message?: string }> => {
      if (method === "api_key") {
        const apiKey = credentials?.apiKey?.trim();
        if (!apiKey) {
          return { success: false, message: "API key is required" };
        }
        await ProviderConfigModel.findOneAndUpdate(
          { providerId: "claude" },
          {
            $set: {
              "credentials.apiKey": encryptSecret(apiKey, loadOrCreateKey()),
              authMethod: "api_key",
              updatedAt: new Date(),
            },
          },
          { upsert: true, new: true },
        );
        return {
          success: true,
          message: "Anthropic API Key saved successfully.",
        };
      }

      if (method === "oauth") {
        try {
          const child = spawn("claude", ["auth", "login", "--claudeai"], {
            shell: true,
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          return {
            success: true,
            message:
              "Browser opened for Claude.ai sign-in. Please complete login in your browser.",
          };
        } catch (err) {
          return {
            success: false,
            message: `Failed to launch browser login: ${
              err instanceof Error ? err.message : String(err)
            }`,
          };
        }
      }

      return { success: false, message: `Unsupported login method: ${method}` };
    },

    // Only removes the API key Aggcode stored. The CLI login is shared with
    // every other Claude tool on the machine, so signing it out from here
    // would end sessions the user never asked to touch.
    logout: async (): Promise<{ success: boolean; message?: string }> => {
      if (mongoose.connection.readyState === 1) {
        await ProviderConfigModel.deleteOne({ providerId: "claude" });
      }

      cliAuthStatus.invalidate();
      const cli = await cliAuthStatus.get();
      if (cli.isAuthenticated) {
        return {
          success: true,
          message: `Removed the API key stored in Aggcode. You are still signed in through the Claude CLI (${cli.accountName}), which Aggcode does not sign out because other Claude tools share it. Run \`claude auth logout\` in a terminal to end it.`,
        };
      }
      return {
        success: true,
        message: "Removed the API key stored in Aggcode.",
      };
    },
  };

  async *runAgent({
    prompt,
    cwd,
    workspaceId,
    sessionId,
    resumeId,
    model,
    effort,
    historyContext,
    signal,
  }: AgentRunParams): AsyncGenerator<AgentEvent, void, unknown> {
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

    const mcpServer = createWorkspaceMcpServer(workspaceId, sessionId);

    const effortLevel =
      effort === "low" ||
      effort === "medium" ||
      effort === "high" ||
      effort === "max"
        ? effort
        : undefined;

    const abortController = signal ? new AbortController() : undefined;
    if (signal && abortController) {
      signal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
    }

    let storedApiKey = process.env.ANTHROPIC_API_KEY;
    if (mongoose.connection.readyState === 1) {
      try {
        storedApiKey = (await readStoredApiKey()) || storedApiKey;
      } catch (err) {
        console.warn("[claude] Could not read the stored API key:", err);
      }
    }

    const envVars: Record<string, string | undefined> = {
      ...process.env,
      ...(storedApiKey ? { ANTHROPIC_API_KEY: storedApiKey } : {}),
    };

    for await (const message of query({
      prompt: fullPrompt,
      options: {
        cwd,
        allowedTools: ["Read", "Edit", "Glob"],
        mcpServers: {
          aggcode_workspace: mcpServer,
        },
        resume: resumeId,
        model: model || undefined,
        effort: effortLevel,
        permissionMode: "acceptEdits",
        // Emits `stream_event` frames carrying raw Messages API deltas, which
        // is what makes the prose appear as it is written.
        includePartialMessages: true,
        abortController,
        env: envVars,
      },
    })) {
      // Prose arrives here, token by token.
      if (message.type === "stream_event") {
        const { event } = message;
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text_delta", text: event.delta.text };
        }
        continue;
      }

      // Completed blocks arrive here. Text is skipped because the deltas
      // above already carried it; only tool calls are new information.
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            yield {
              type: "tool_start",
              toolId: block.id,
              name: block.name,
              detail: toolDetail(block.input, cwd),
            };
          }
        }
        continue;
      }

      // The CLI emits user-role messages for content it adds itself, which is
      // chiefly the tool_result blocks answering the tool_use blocks above.
      if (message.type === "user") {
        for (const result of extractToolResults(message.message.content)) {
          yield {
            type: "tool_result",
            toolId: result.toolId,
            status: result.isError ? "error" : "done",
            output: result.output,
          };
        }
        continue;
      }

      // Live thinking-token estimate. The SDK documents this as intended for
      // exactly this kind of progress indicator.
      if (message.type === "system" && message.subtype === "thinking_tokens") {
        yield {
          type: "thinking_tokens",
          tokens: message.estimated_tokens,
        };
        continue;
      }

      if (message.type !== "result") {
        continue;
      }

      if (message.subtype === "success") {
        const text = message.result.trim();

        if (message.is_error) {
          yield {
            type: "error",
            message: text || "The agent stopped on an error.",
          };
        } else if (text === "") {
          yield {
            type: "error",
            message: "The agent finished without producing a reply.",
          };
        } else {
          yield {
            type: "success",
            text: message.result,
            sessionId: message.session_id,
          };
        }
      } else {
        yield {
          type: "error",
          message:
            message.errors.length > 0
              ? message.errors.join("\n")
              : RESULT_ERROR_LABEL[message.subtype],
        };
      }
    }
  }
}
