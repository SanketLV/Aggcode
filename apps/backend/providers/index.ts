import type { ProviderOption } from "commons/types";
import type { AgentProvider } from "./types";
import { buildAuthSnapshot } from "./authScope";
import { ClaudeProvider } from "./claude";
import { OpenCodeProvider } from "./opencode";

export type {
  AgentEvent,
  AgentProvider,
  AgentRunParams,
  AuthProviderPlugin,
  ProviderAuthStatus,
  ProviderDescriptor,
} from "./types";

const claudeProvider = new ClaudeProvider();
const openCodeProvider = new OpenCodeProvider();

const providerRegistry = new Map<string, AgentProvider>();
providerRegistry.set(claudeProvider.id, claudeProvider);
providerRegistry.set(openCodeProvider.id, openCodeProvider);

export function registerProvider(provider: AgentProvider): void {
  providerRegistry.set(provider.id, provider);
}

export function unregisterProvider(id: string): void {
  providerRegistry.delete(id);
}

export function getProvider(id?: string): AgentProvider {
  const chosen = id?.toLowerCase() || process.env.AI_PROVIDER || "claude";
  return providerRegistry.get(chosen) ?? claudeProvider;
}

// Strict lookup for auth actions: getProvider's Claude fallback would turn a
// sign-out aimed at a mistyped id into a Claude sign-out.
export function findProvider(id: string): AgentProvider | undefined {
  return providerRegistry.get(id.toLowerCase());
}

// Each id was checked with a real SDK run. The previous claude-3-7-sonnet and
// claude-3-5-* ids are rejected by the SDK as unknown models.
export const CLAUDE_CATALOG: ProviderOption = {
  id: "claude",
  name: "Claude Code",
  defaultModel: "claude-sonnet-5",
  effortLevels: ["low", "medium", "high", "max"],
  models: [
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", supportsEffort: true },
    { id: "claude-opus-5", name: "Claude Opus 5", supportsEffort: true },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", supportsEffort: false },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", supportsEffort: true },
  ],
};

export function getAllProviders(): AgentProvider[] {
  return Array.from(providerRegistry.values());
}

// Backwards compatibility
export function createProvider(type?: string): AgentProvider {
  return getProvider(type);
}

export function getAuthSnapshot() {
  return buildAuthSnapshot(getAllProviders());
}

export async function getProviderCatalog(): Promise<ProviderOption[]> {
  const catalog: ProviderOption[] = [];
  for (const provider of getAllProviders()) {
    if (
      "getAvailableModels" in provider &&
      typeof (provider as any).getAvailableModels === "function"
    ) {
      const models = await (provider as any).getAvailableModels();
      catalog.push({
        id: provider.id,
        name: provider.name,
        defaultModel: models[0]?.id || "",
        models,
      });
    } else if (provider.id === "claude") {
      catalog.push(CLAUDE_CATALOG);
    }
  }
  return catalog;
}

// Sessions saved before a model was retired still carry its id, and the SDK
// rejects an unknown model outright, so anything off the catalog falls back to
// the provider default rather than failing the run.
export function resolveModel(
  option: ProviderOption | undefined,
  requested: string | undefined,
): string | undefined {
  if (!option || option.models.length === 0) {
    return requested;
  }
  if (requested && option.models.some((m) => m.id === requested)) {
    return requested;
  }
  return option.defaultModel || option.models[0]?.id;
}
