import { describe, expect, test } from "bun:test";
import {
  buildModelOptions,
  parseModelRef,
  type ModelCatalog,
} from "./openCodeModels";

const catalog: ModelCatalog = {
  all: [
    {
      id: "opencode",
      name: "OpenCode Zen",
      models: { "big-pickle": { name: "Big Pickle", reasoning: false } },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-sonnet-4": { name: "Claude Sonnet 4", reasoning: true },
      },
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      models: { "google/gemini-2.5-pro": { name: "Gemini 2.5 Pro" } },
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      models: { "deepseek-chat": { name: "DeepSeek Chat" } },
    },
  ],
  connected: ["openrouter", "opencode"],
};

describe("buildModelOptions", () => {
  test("lists only connected providers, including ones outside the old allowlist", () => {
    const ids = buildModelOptions(catalog).map((m) => m.id);
    expect(ids).toContain("openrouter/google/gemini-2.5-pro");
    expect(ids).toContain("opencode/big-pickle");
    expect(ids).not.toContain("anthropic/claude-sonnet-4");
    expect(ids).not.toContain("deepseek/deepseek-chat");
  });

  test("puts models the user connected ahead of the built-in free ones", () => {
    const ids = buildModelOptions(catalog).map((m) => m.id);
    expect(ids[0]).toBe("openrouter/google/gemini-2.5-pro");
    expect(ids[ids.length - 1]).toBe("opencode/big-pickle");
  });

  test("leads each provider with the default model OpenCode recommends", () => {
    const ids = buildModelOptions({
      all: [
        {
          id: "openrouter",
          name: "OpenRouter",
          models: { "a/obscure": {}, "b/recommended": {}, "c/other": {} },
        },
      ],
      connected: ["openrouter"],
      defaults: { openrouter: "b/recommended" },
    }).map((m) => m.id);
    expect(ids).toEqual([
      "openrouter/b/recommended",
      "openrouter/a/obscure",
      "openrouter/c/other",
    ]);
  });

  test("keeps catalog order when the recommended default is unknown", () => {
    const ids = buildModelOptions({
      all: [{ id: "x", name: "X", models: { m1: {}, m2: {} } }],
      connected: ["x"],
      defaults: { x: "gone" },
    }).map((m) => m.id);
    expect(ids).toEqual(["x/m1", "x/m2"]);
  });

  test("flags reasoning models and prefixes the provider name", () => {
    const [option] = buildModelOptions({
      all: catalog.all,
      connected: ["anthropic"],
    });
    expect(option).toEqual({
      id: "anthropic/claude-sonnet-4",
      name: "Anthropic: Claude Sonnet 4",
      supportsEffort: true,
    });
  });

  test("falls back to the model id when a model has no name", () => {
    const [option] = buildModelOptions({
      all: [{ id: "x", name: "X", models: { m1: {} } }],
      connected: ["x"],
    });
    expect(option?.name).toBe("X: m1");
  });

  test("returns nothing when no provider is connected", () => {
    expect(buildModelOptions({ all: catalog.all, connected: [] })).toEqual([]);
  });

  test("ignores connected ids the catalog does not know", () => {
    expect(
      buildModelOptions({ all: catalog.all, connected: ["ghost"] }),
    ).toEqual([]);
  });
});

describe("parseModelRef", () => {
  test("splits provider and model", () => {
    expect(parseModelRef("anthropic/claude-sonnet-4")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4",
    });
  });

  test("splits on the first slash only, keeping nested model ids whole", () => {
    expect(parseModelRef("openrouter/google/gemini-2.5-pro")).toEqual({
      providerID: "openrouter",
      modelID: "google/gemini-2.5-pro",
    });
  });

  test("treats a bare id as an opencode model", () => {
    expect(parseModelRef("big-pickle")).toEqual({
      providerID: "opencode",
      modelID: "big-pickle",
    });
  });

  test("rejects a ref with an empty side", () => {
    expect(parseModelRef("openrouter/")).toBeUndefined();
    expect(parseModelRef("/model")).toBeUndefined();
    expect(parseModelRef("")).toBeUndefined();
  });
});
