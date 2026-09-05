import type { ProviderOption } from "commons/types";
import type { AgentProvider } from "./types";
import { ClaudeProvider } from "./claude";
import { OpenCodeProvider } from "./opencode";

export type { AgentEvent, AgentProvider, AgentRunParams } from "./types";

const claudeProvider = new ClaudeProvider();
const openCodeProvider = new OpenCodeProvider();

const providers: Record<string, AgentProvider> = {
  claude: claudeProvider,
  opencode: openCodeProvider,
};

export function getProvider(id?: string): AgentProvider {
  const chosen = id?.toLowerCase() || process.env.AI_PROVIDER || "claude";
  return providers[chosen] ?? claudeProvider;
}

// Backwards compatibility
export function createProvider(type?: string): AgentProvider {
  return getProvider(type);
}

export async function getProviderCatalog(): Promise<ProviderOption[]> {
  const opencodeModels = await openCodeProvider.getAvailableModels();

  return [
    {
      id: "claude",
      name: "Claude Code",
      defaultModel: "claude-3-7-sonnet",
      effortLevels: ["low", "medium", "high", "max"],
      models: [
        {
          id: "claude-3-7-sonnet",
          name: "Claude 3.7 Sonnet",
          supportsEffort: true,
        },
        {
          id: "claude-3-5-sonnet",
          name: "Claude 3.5 Sonnet",
          supportsEffort: false,
        },
        {
          id: "claude-3-5-haiku",
          name: "Claude 3.5 Haiku",
          supportsEffort: false,
        },
        {
          id: "claude-opus-4-6",
          name: "Claude Opus 4.6",
          supportsEffort: true,
        },
      ],
    },
    {
      id: "opencode",
      name: "OpenCode",
      defaultModel: opencodeModels[0]?.id || "opencode/nemotron-3-ultra-free",
      models: opencodeModels,
    },
  ];
}
