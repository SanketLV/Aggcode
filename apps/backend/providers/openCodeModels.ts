import type { ModelOption } from "commons/types";

// The built-in provider serves the free models, which exist whether or not the
// user connected anything.
const BUILT_IN_PROVIDER_ID = "opencode";

type CatalogModel = { name?: string; reasoning?: boolean };
type CatalogProvider = {
  id: string;
  name: string;
  models?: Record<string, CatalogModel>;
};

export type ModelCatalog = {
  all: CatalogProvider[];
  connected: string[];
  // provider id -> the model OpenCode recommends for it
  defaults?: Record<string, string>;
};

export function buildModelOptions(catalog: ModelCatalog): ModelOption[] {
  const connected = new Set(catalog.connected);
  const options: ModelOption[] = [];

  for (const provider of catalog.all) {
    if (!connected.has(provider.id) || !provider.models) {
      continue;
    }

    // A large catalog (OpenRouter) lists models in arbitrary order, and the
    // first one becomes the default, so lead with the recommended model.
    const recommended = catalog.defaults?.[provider.id];
    const entries = Object.entries(provider.models).sort(
      ([a], [b]) => Number(b === recommended) - Number(a === recommended),
    );

    for (const [modelId, info] of entries) {
      options.push({
        id: `${provider.id}/${modelId}`,
        name: `${provider.name}: ${info.name || modelId}`,
        supportsEffort: info.reasoning === true,
      });
    }
  }

  // The first option becomes the default model, so lead with something the
  // user connected rather than a built-in free model.
  const prefix = `${BUILT_IN_PROVIDER_ID}/`;
  return [
    ...options.filter((o) => !o.id.startsWith(prefix)),
    ...options.filter((o) => o.id.startsWith(prefix)),
  ];
}

// Split on the first slash only: OpenRouter model ids contain slashes
// themselves (`openrouter/google/gemini-2.5-pro`).
export function parseModelRef(
  model: string,
): { providerID: string; modelID: string } | undefined {
  const slash = model.indexOf("/");
  if (slash === -1) {
    return model
      ? { providerID: BUILT_IN_PROVIDER_ID, modelID: model }
      : undefined;
  }

  const providerID = model.slice(0, slash);
  const modelID = model.slice(slash + 1);
  return providerID && modelID ? { providerID, modelID } : undefined;
}
