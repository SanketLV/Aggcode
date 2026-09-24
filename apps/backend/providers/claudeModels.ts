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

export type LiveCatalog = {
  // Never waits: the live catalog if one is cached, else the fallback.
  get(): ProviderOption;
  warm(): void;
  // The list belongs to the signed-in account, so drop it when that changes.
  invalidate(): void;
};

// The SDK answers in seconds and starts a process to do it, so reads only ever
// see the cache and a refresh runs in the background.
export function createLiveCatalog(deps: {
  fallback: ProviderOption;
  fetchRows: () => Promise<readonly SdkModelRow[]>;
  ttlMs: number;
  // Wait this long after a failure before trying again. A signed-out user
  // would otherwise start a process on every catalog read.
  retryMs: number;
  now?: () => number;
  onError?: (err: unknown) => void;
}): LiveCatalog {
  const now = deps.now ?? Date.now;
  let live: ProviderOption | null = null;
  let liveAt = 0;
  let retryAt = 0;
  // A fetch that began before an invalidate belongs to the previous account.
  let generation = 0;
  let inFlight: Promise<void> | null = null;

  function start(): void {
    const mine = generation;
    const run = (async () => {
      try {
        const rows = await deps.fetchRows();
        const catalog = buildClaudeCatalog(rows, deps.fallback);
        if (!catalog) {
          throw new Error("The SDK returned no models");
        }
        if (mine === generation) {
          live = catalog;
          liveAt = now();
          retryAt = 0;
        }
      } catch (err) {
        if (mine === generation) {
          retryAt = now() + deps.retryMs;
        }
        deps.onError?.(err);
      }
    })();
    inFlight = run;
    void run.finally(() => {
      if (inFlight === run) {
        inFlight = null;
      }
    });
  }

  function refreshIfNeeded(): void {
    if (inFlight || now() < retryAt) {
      return;
    }
    if (live && now() - liveAt < deps.ttlMs) {
      return;
    }
    start();
  }

  return {
    get() {
      refreshIfNeeded();
      return live ?? deps.fallback;
    },
    warm: refreshIfNeeded,
    invalidate() {
      generation++;
      live = null;
      retryAt = 0;
      inFlight = null;
      start();
    },
  };
}
