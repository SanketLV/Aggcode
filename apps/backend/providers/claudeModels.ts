import {
  DEFAULT_EFFORT_LEVELS,
  findModel,
  pickEffort,
  type EffortLevel,
} from "commons/model-rules";
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

// `builtIn` are models that were verified with a real run. One the SDK no
// longer lists stays after the live rows, because the SDK still accepts it
// (Opus 4.6 does) and sessions saved on it should keep running on it.
//
// Returns undefined for an empty list so the caller keeps serving the verified
// fallback instead of showing an empty picker.
export function buildClaudeCatalog(
  rows: readonly SdkModelRow[],
  provider: { id: string; name: string },
  builtIn: readonly ModelOption[] = [],
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

  for (const legacy of builtIn) {
    if (!findModel(models, legacy.id)) {
      models.push(legacy);
    }
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
  // The signal is aborted when the fetch is replaced, so the process it
  // started does not outlive the answer nobody wants any more.
  fetchRows: (signal: AbortSignal) => Promise<readonly SdkModelRow[]>;
  ttlMs: number;
  // Wait this long after a failure before trying again, doubling with each
  // further failure up to maxRetryMs. A signed-out user would otherwise start
  // a process every minute for as long as the app is open.
  retryMs: number;
  maxRetryMs: number;
  now?: () => number;
  onError?: (err: unknown) => void;
}): LiveCatalog {
  const now = deps.now ?? Date.now;
  let live: ProviderOption | null = null;
  let liveAt = 0;
  let retryAt = 0;
  let failures = 0;
  // A fetch that began before an invalidate belongs to the previous account.
  let generation = 0;
  let inFlight: Promise<void> | null = null;
  let current: AbortController | null = null;

  function start(): void {
    const mine = generation;
    const controller = new AbortController();
    current = controller;
    const run = (async () => {
      try {
        const rows = await deps.fetchRows(controller.signal);
        const catalog = buildClaudeCatalog(
          rows,
          deps.fallback,
          deps.fallback.models,
        );
        if (!catalog) {
          throw new Error("The SDK returned no models");
        }
        if (mine === generation) {
          live = catalog;
          liveAt = now();
          retryAt = 0;
          failures = 0;
        }
      } catch (err) {
        // A replaced fetch failing is expected, not worth a warning.
        if (mine === generation) {
          failures++;
          retryAt =
            now() +
            Math.min(deps.retryMs * 2 ** (failures - 1), deps.maxRetryMs);
          deps.onError?.(err);
        }
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
      current?.abort();
      generation++;
      live = null;
      retryAt = 0;
      failures = 0;
      inFlight = null;
      start();
    },
  };
}

// Sessions saved before a model was retired still carry its id, and the SDK
// rejects an unknown model outright, so anything the catalog does not offer
// falls back to the provider default rather than failing the run.
export function resolveModelId(
  option: ProviderOption | undefined,
  requested: string | undefined,
): string | undefined {
  if (!option || option.models.length === 0) {
    return requested;
  }
  const match = findModel(option.models, requested);
  if (match) {
    return match.id;
  }
  return option.defaultModel || option.models[0]?.id;
}

// What a run sends to the SDK. The effort is chosen for the model that will
// actually run, which is not always the one the session saved.
export function resolveClaudeRun(
  option: ProviderOption,
  savedModel: string | undefined,
  savedEffort: string | undefined,
): { model: string | undefined; effort: EffortLevel | undefined } {
  const model = resolveModelId(option, savedModel);
  const row = option.models.find((m) => m.id === model);
  const levels = row?.supportsEffort
    ? (row.effortLevels ?? DEFAULT_EFFORT_LEVELS)
    : undefined;
  return { model, effort: pickEffort(levels, savedEffort) };
}
