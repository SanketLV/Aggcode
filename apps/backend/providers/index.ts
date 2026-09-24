import { DEFAULT_EFFORT_LEVELS } from "commons/model-rules";
import type { ProviderOption } from "commons/types";
import type { AgentProvider } from "./types";
import { buildAuthSnapshot } from "./authScope";
import { ClaudeProvider, fetchSupportedModels } from "./claude";
import { createLiveCatalog, resolveModelId } from "./claudeModels";
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
  models: [
    {
      id: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      supportsEffort: true,
      effortLevels: [...DEFAULT_EFFORT_LEVELS],
    },
    {
      id: "claude-opus-5",
      name: "Claude Opus 5",
      supportsEffort: true,
      effortLevels: [...DEFAULT_EFFORT_LEVELS],
    },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", supportsEffort: false },
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      supportsEffort: true,
      effortLevels: [...DEFAULT_EFFORT_LEVELS],
    },
  ],
};

// How long a fetched list is trusted, and how long to wait after a failed
// fetch before trying again.
const CLAUDE_CATALOG_TTL_MS = 10 * 60_000;
const CLAUDE_CATALOG_RETRY_MS = 60_000;

// The SDK's own list for the signed-in account, cached off the request path.
// CLAUDE_CATALOG is what is served until a live list exists, and whenever
// fetching one fails.
const claudeLiveCatalog = createLiveCatalog({
  fallback: CLAUDE_CATALOG,
  fetchRows: () => fetchSupportedModels(),
  ttlMs: CLAUDE_CATALOG_TTL_MS,
  retryMs: CLAUDE_CATALOG_RETRY_MS,
  onError: (err) =>
    console.warn(
      "[claude] Could not fetch the live model list, using the built-in one:",
      err,
    ),
});

export const getClaudeCatalog = () => claudeLiveCatalog.get();
export const warmClaudeCatalog = () => claudeLiveCatalog.warm();
export const invalidateClaudeCatalog = () => claudeLiveCatalog.invalidate();

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
      catalog.push(getClaudeCatalog());
    }
  }
  return catalog;
}

export { resolveModelId as resolveModel } from "./claudeModels";
