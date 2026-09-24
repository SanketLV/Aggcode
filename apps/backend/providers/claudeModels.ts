import type { ModelOption, ProviderOption } from "commons/types";

// The fields of the SDK's ModelInfo that the catalog uses. Declared here
// instead of imported so the mapper is testable without loading the SDK.
export type SdkModelRow = {
  value: string;
  resolvedModel?: string;
  displayName: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: readonly string[];
};

const DEFAULT_ROW_VALUE = "default";

// The concrete id, never the alias: aliases move to newer models over time,
// while a saved session has to keep the model it chose. The `[1m]` some values
// carry selects a 1M window that these models already have on the Anthropic
// API, so it is not part of the id.
function concreteId(row: SdkModelRow): string {
  return row.resolvedModel ?? row.value;
}

// Returns undefined for an empty list so the caller keeps serving the verified
// fallback instead of showing an empty picker.
export function buildClaudeCatalog(
  rows: readonly SdkModelRow[],
  provider: { id: string; name: string },
): ProviderOption | undefined {
  const defaultRow = rows.find((r) => r.value === DEFAULT_ROW_VALUE);

  // "Default" is a label for whichever model the others already name, so it
  // only gets a row of its own when no other row covers that model.
  const namedIds = new Set(
    rows.filter((r) => r !== defaultRow).map((r) => concreteId(r)),
  );
  const shown = rows.filter(
    (r) => r !== defaultRow || !namedIds.has(concreteId(r)),
  );

  const seen = new Set<string>();
  const models: ModelOption[] = [];
  for (const row of shown) {
    const id = concreteId(row);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    const supportsEffort = row.supportsEffort === true;
    models.push({
      id,
      name: row.displayName,
      supportsEffort,
      ...(supportsEffort && row.supportedEffortLevels
        ? { effortLevels: [...row.supportedEffortLevels] }
        : {}),
    });
  }

  const first = models[0];
  if (!first) {
    return undefined;
  }

  return {
    id: provider.id,
    name: provider.name,
    models,
    defaultModel: defaultRow ? concreteId(defaultRow) : first.id,
  };
}
