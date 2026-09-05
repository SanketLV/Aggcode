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

export interface AgentProvider {
  id: string;
  name: string;
  runAgent(params: AgentRunParams): AsyncGenerator<AgentEvent, void, unknown>;
}
