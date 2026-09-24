import { describe, expect, test } from "bun:test";
import type { ProviderOption } from "commons/types";
import {
  buildClaudeCatalog,
  createLiveCatalog,
  resolveClaudeRun,
  resolveModelId,
  type SdkModelRow,
} from "./claudeModels";

const BASE = { id: "claude", name: "Claude Code" };
const FULL = ["low", "medium", "high", "xhigh", "max"];

// What Query.supportedModels() returned for a signed-in account.
const sdkRows: SdkModelRow[] = [
  {
    value: "default",
    resolvedModel: "claude-sonnet-5",
    displayName: "Default (recommended)",
    supportsEffort: true,
    supportedEffortLevels: FULL,
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5",
    displayName: "Sonnet",
    supportsEffort: true,
    supportedEffortLevels: FULL,
  },
  {
    value: "claude-fable-5-1[1m]",
    resolvedModel: "claude-fable-5-1",
    displayName: "Fable",
    supportsEffort: true,
    supportedEffortLevels: FULL,
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5",
    displayName: "Opus",
    supportsEffort: true,
    supportedEffortLevels: FULL,
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku",
  },
];

describe("buildClaudeCatalog", () => {
  test("default and sonnet collapse into one row", () => {
    const catalog = buildClaudeCatalog(sdkRows, BASE);
    const ids = catalog?.models.map((m) => m.id);
    expect(ids).toEqual([
      "claude-sonnet-5",
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-haiku-4-5-20251001",
    ]);
  });

  test("the row keeps the named alias, not the Default label", () => {
    const catalog = buildClaudeCatalog(sdkRows, BASE);
    expect(catalog?.models[0]?.name).toBe("Sonnet");
  });

  test("the default row's concrete id becomes the default model", () => {
    expect(buildClaudeCatalog(sdkRows, BASE)?.defaultModel).toBe(
      "claude-sonnet-5",
    );
  });

  // The suffix selects a 1M window the model already has on the Anthropic API,
  // so the concrete id is the one to store and send.
  test("uses the resolved id, not an alias or a [1m] value", () => {
    const fable = buildClaudeCatalog(sdkRows, BASE)?.models.find(
      (m) => m.name === "Fable",
    );
    expect(fable?.id).toBe("claude-fable-5-1");
  });

  test("falls back to value when there is no resolved id", () => {
    const catalog = buildClaudeCatalog(
      [{ value: "claude-custom-1", displayName: "Custom" }],
      BASE,
    );
    expect(catalog?.models.map((m) => m.id)).toEqual(["claude-custom-1"]);
  });

  test("copies effort support and levels per model", () => {
    const models = buildClaudeCatalog(sdkRows, BASE)?.models ?? [];
    expect(models.find((m) => m.name === "Opus")).toMatchObject({
      supportsEffort: true,
      effortLevels: FULL,
    });
  });

  test("a model with no effort support gets no levels", () => {
    const haiku = buildClaudeCatalog(sdkRows, BASE)?.models.find(
      (m) => m.name === "Haiku",
    );
    expect(haiku?.supportsEffort).toBe(false);
    expect(haiku?.effortLevels).toBeUndefined();
  });

  test("effort support without a level list leaves the levels unset", () => {
    const catalog = buildClaudeCatalog(
      [{ value: "x", displayName: "X", supportsEffort: true }],
      BASE,
    );
    expect(catalog?.models[0]?.supportsEffort).toBe(true);
    expect(catalog?.models[0]?.effortLevels).toBeUndefined();
  });

  test("a default that no other row covers still gets a row", () => {
    const catalog = buildClaudeCatalog(
      [
        {
          value: "default",
          resolvedModel: "claude-sonnet-5",
          displayName: "Default (recommended)",
        },
        {
          value: "opus",
          resolvedModel: "claude-opus-5",
          displayName: "Opus",
        },
      ],
      BASE,
    );
    expect(catalog?.models.map((m) => m.id)).toEqual([
      "claude-sonnet-5",
      "claude-opus-5",
    ]);
    expect(catalog?.defaultModel).toBe("claude-sonnet-5");
  });

  test("without a default row the first model is the default", () => {
    const catalog = buildClaudeCatalog(sdkRows.slice(2), BASE);
    expect(catalog?.defaultModel).toBe("claude-fable-5-1");
  });

  test("carries the provider id and name", () => {
    const catalog = buildClaudeCatalog(sdkRows, BASE);
    expect(catalog?.id).toBe("claude");
    expect(catalog?.name).toBe("Claude Code");
  });

  test("an empty list is unavailable, not an empty picker", () => {
    expect(buildClaudeCatalog([], BASE)).toBeUndefined();
  });

  test("a list with only a default row still gives that one model", () => {
    const catalog = buildClaudeCatalog(
      [
        {
          value: "default",
          resolvedModel: "claude-sonnet-5",
          displayName: "Default (recommended)",
        },
      ],
      BASE,
    );
    expect(catalog?.models.map((m) => m.id)).toEqual(["claude-sonnet-5"]);
    expect(catalog?.defaultModel).toBe("claude-sonnet-5");
  });
});

// A promise the test resolves or rejects by hand, so it decides when a
// fetch "finishes".
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const FALLBACK: ProviderOption = {
  id: "claude",
  name: "Claude Code",
  defaultModel: "claude-sonnet-5",
  models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5" }],
};

const TTL = 10 * 60_000;
const RETRY = 60_000;

function harness(
  fetches: Array<ReturnType<typeof deferred<readonly SdkModelRow[]>>>,
) {
  let now = 1_000_000;
  let calls = 0;
  const errors: unknown[] = [];
  const catalog = createLiveCatalog({
    fallback: FALLBACK,
    fetchRows: () => {
      const next = fetches[calls];
      calls++;
      if (!next) {
        throw new Error("unexpected extra fetch");
      }
      return next.promise;
    },
    ttlMs: TTL,
    retryMs: RETRY,
    now: () => now,
    onError: (err) => errors.push(err),
  });
  return {
    catalog,
    errors,
    calls: () => calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createLiveCatalog", () => {
  test("serves the fallback and starts one fetch before anything has loaded", () => {
    const h = harness([deferred()]);
    expect(h.catalog.get()).toBe(FALLBACK);
    expect(h.calls()).toBe(1);
  });

  test("serves the live catalog once the fetch lands", async () => {
    const fetch = deferred<readonly SdkModelRow[]>();
    const h = harness([fetch]);
    h.catalog.get();
    fetch.resolve(sdkRows);
    await flush();
    expect(h.catalog.get().models.map((m) => m.id)).toContain(
      "claude-fable-5-1",
    );
  });

  test("callers while a fetch is in flight share it", () => {
    const h = harness([deferred()]);
    h.catalog.get();
    h.catalog.get();
    h.catalog.warm();
    expect(h.calls()).toBe(1);
  });

  test("does not refetch inside the ttl, and refetches after it", async () => {
    const first = deferred<readonly SdkModelRow[]>();
    const second = deferred<readonly SdkModelRow[]>();
    const h = harness([first, second]);
    h.catalog.get();
    first.resolve(sdkRows);
    await flush();

    h.advance(TTL - 1);
    h.catalog.get();
    expect(h.calls()).toBe(1);

    h.advance(2);
    h.catalog.get();
    expect(h.calls()).toBe(2);
  });

  test("keeps serving the old live catalog while a refresh is running", async () => {
    const first = deferred<readonly SdkModelRow[]>();
    const h = harness([first, deferred()]);
    h.catalog.get();
    first.resolve(sdkRows);
    await flush();
    const live = h.catalog.get();

    h.advance(TTL + 1);
    expect(h.catalog.get()).toBe(live);
  });

  test("a failed fetch serves the fallback and reports the error", async () => {
    const fetch = deferred<readonly SdkModelRow[]>();
    const h = harness([fetch]);
    h.catalog.get();
    fetch.reject(new Error("claude: command not found"));
    await flush();

    expect(h.catalog.get()).toBe(FALLBACK);
    expect(h.errors).toHaveLength(1);
  });

  // A signed-out user would otherwise start a multi-second process on every
  // catalog read.
  test("backs off after a failure instead of retrying on every read", async () => {
    const first = deferred<readonly SdkModelRow[]>();
    const second = deferred<readonly SdkModelRow[]>();
    const h = harness([first, second]);
    h.catalog.get();
    first.reject(new Error("signed out"));
    await flush();

    h.catalog.get();
    h.catalog.get();
    h.advance(RETRY - 1);
    h.catalog.get();
    expect(h.calls()).toBe(1);

    h.advance(2);
    h.catalog.get();
    expect(h.calls()).toBe(2);
  });

  test("a failure does not throw away a good catalog", async () => {
    const first = deferred<readonly SdkModelRow[]>();
    const second = deferred<readonly SdkModelRow[]>();
    const h = harness([first, second]);
    h.catalog.get();
    first.resolve(sdkRows);
    await flush();
    const live = h.catalog.get();

    h.advance(TTL + 1);
    h.catalog.get();
    second.reject(new Error("timed out"));
    await flush();

    expect(h.catalog.get()).toBe(live);
  });

  test("an empty list counts as a failure", async () => {
    const fetch = deferred<readonly SdkModelRow[]>();
    const h = harness([fetch]);
    h.catalog.get();
    fetch.resolve([]);
    await flush();

    expect(h.catalog.get()).toBe(FALLBACK);
    expect(h.errors).toHaveLength(1);
  });

  test("invalidate drops the live catalog and fetches again", async () => {
    const first = deferred<readonly SdkModelRow[]>();
    const second = deferred<readonly SdkModelRow[]>();
    const h = harness([first, second]);
    h.catalog.get();
    first.resolve(sdkRows);
    await flush();

    h.catalog.invalidate();
    expect(h.catalog.get()).toBe(FALLBACK);
    expect(h.calls()).toBe(2);
  });

  test("invalidate clears a failure backoff so a new sign-in retries at once", async () => {
    const first = deferred<readonly SdkModelRow[]>();
    const second = deferred<readonly SdkModelRow[]>();
    const h = harness([first, second]);
    h.catalog.get();
    first.reject(new Error("signed out"));
    await flush();

    h.catalog.invalidate();
    expect(h.calls()).toBe(2);
  });

  // The list belongs to the account that was signed in when the fetch began.
  test("a fetch that started before an invalidate is ignored", async () => {
    const stale = deferred<readonly SdkModelRow[]>();
    const fresh = deferred<readonly SdkModelRow[]>();
    const h = harness([stale, fresh]);
    h.catalog.get();
    h.catalog.invalidate();

    stale.resolve(sdkRows);
    await flush();
    expect(h.catalog.get()).toBe(FALLBACK);

    fresh.resolve(sdkRows.slice(3));
    await flush();
    expect(h.catalog.get().models.map((m) => m.id)).toEqual([
      "claude-opus-5",
      "claude-haiku-4-5-20251001",
    ]);
  });

  test("a fetch that throws synchronously is a failure, not a crash", async () => {
    let now = 0;
    const errors: unknown[] = [];
    const catalog = createLiveCatalog({
      fallback: FALLBACK,
      fetchRows: () => {
        throw new Error("spawn failed");
      },
      ttlMs: TTL,
      retryMs: RETRY,
      now: () => now,
      onError: (err) => errors.push(err),
    });
    expect(catalog.get()).toBe(FALLBACK);
    await flush();
    expect(errors).toHaveLength(1);
    now += 1;
  });
});

describe("resolveModelId", () => {
  const live = buildClaudeCatalog(sdkRows, BASE) as ProviderOption;

  test("keeps a saved id the catalog offers", () => {
    expect(resolveModelId(live, "claude-opus-5")).toBe("claude-opus-5");
  });

  test("a saved undated Haiku id resolves to the dated row", () => {
    expect(resolveModelId(live, "claude-haiku-4-5")).toBe(
      "claude-haiku-4-5-20251001",
    );
  });

  test("an id the catalog no longer offers falls back to the default", () => {
    expect(resolveModelId(live, "claude-opus-4-6")).toBe("claude-sonnet-5");
  });

  test("nothing saved runs the default", () => {
    expect(resolveModelId(live, undefined)).toBe("claude-sonnet-5");
  });

  test("the fallback catalog behaves the same way", () => {
    expect(resolveModelId(FALLBACK, "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(resolveModelId(FALLBACK, "claude-3-7-sonnet")).toBe(
      "claude-sonnet-5",
    );
  });

  test("a catalog with no models passes the request through", () => {
    const empty: ProviderOption = { ...FALLBACK, models: [] };
    expect(resolveModelId(empty, "claude-x")).toBe("claude-x");
    expect(resolveModelId(undefined, "claude-x")).toBe("claude-x");
  });
});

describe("resolveClaudeRun", () => {
  const live = buildClaudeCatalog(sdkRows, BASE) as ProviderOption;

  test("runs a saved model with a level it supports", () => {
    expect(resolveClaudeRun(live, "claude-opus-5", "xhigh")).toEqual({
      model: "claude-opus-5",
      effort: "xhigh",
    });
  });

  test("an unsupported level moves to the nearest supported one", () => {
    const limited: ProviderOption = {
      ...FALLBACK,
      models: [
        {
          id: "claude-sonnet-5",
          name: "Sonnet",
          supportsEffort: true,
          effortLevels: ["low", "medium", "high"],
        },
      ],
    };
    expect(resolveClaudeRun(limited, "claude-sonnet-5", "max")).toEqual({
      model: "claude-sonnet-5",
      effort: "high",
    });
  });

  test("a model without effort support gets no effort", () => {
    expect(resolveClaudeRun(live, "claude-haiku-4-5", "high")).toEqual({
      model: "claude-haiku-4-5-20251001",
      effort: undefined,
    });
  });

  test("effort follows the model that actually runs, not the saved one", () => {
    // claude-opus-4-6 is gone, so the default runs and its levels apply.
    expect(resolveClaudeRun(live, "claude-opus-4-6", "xhigh")).toEqual({
      model: "claude-sonnet-5",
      effort: "xhigh",
    });
  });

  test("a model that supports effort but lists no levels gets the verified four", () => {
    const legacy: ProviderOption = {
      ...FALLBACK,
      models: [{ id: "claude-sonnet-5", name: "Sonnet", supportsEffort: true }],
    };
    expect(resolveClaudeRun(legacy, "claude-sonnet-5", "xhigh").effort).toBe(
      "high",
    );
    expect(resolveClaudeRun(legacy, "claude-sonnet-5", "max").effort).toBe(
      "max",
    );
  });

  test("no saved effort sends none", () => {
    expect(resolveClaudeRun(live, "claude-opus-5", undefined).effort).toBe(
      undefined,
    );
  });

  test("a stray effort string is never sent", () => {
    expect(resolveClaudeRun(live, "claude-opus-5", "turbo").effort).toBe(
      undefined,
    );
  });
});
