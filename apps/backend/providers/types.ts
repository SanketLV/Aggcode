export type AgentEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_start";
      toolId: string;
      name: string;
      detail: string;
    }
  | {
      type: "tool_result";
      toolId: string;
      status: "done" | "error";
      output: string;
    }
  | { type: "thinking_tokens"; tokens: number }
  | { type: "success"; text: string; sessionId: string }
  | { type: "error"; message: string };

export interface AgentRunParams {
  prompt: string;
  cwd: string;
  workspaceId: string;
  sessionId: string;
  resumeId?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "max" | string;
  historyContext?: string;
  signal?: AbortSignal;
}

import type {
  AuthField,
  AuthMethodDescriptor,
  ProviderAuthStatus,
  ProviderDescriptor,
} from "commons/types";

export type {
  AuthField,
  AuthMethodDescriptor,
  ProviderAuthStatus,
  ProviderDescriptor,
};

export interface AuthProviderPlugin {
  getAuthMethods(): AuthMethodDescriptor[];
  getAuthStatus(): Promise<ProviderAuthStatus>;
  login(params: {
    method: string;
    credentials?: Record<string, string>;
  }): Promise<{ success: boolean; message?: string }>;
  logout(params?: {
    target?: string;
  }): Promise<{ success: boolean; message?: string }>;
}

export interface AgentProvider {
  id: string;
  name: string;
  auth?: AuthProviderPlugin;
  runAgent(params: AgentRunParams): AsyncGenerator<AgentEvent, void, unknown>;
}
