import { describe, expect, test } from "bun:test";
import { buildClaudeCatalog, type SdkModelRow } from "./claudeModels";

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
