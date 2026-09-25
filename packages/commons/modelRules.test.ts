import { describe, expect, test } from "bun:test";
import { findModel, isEffortLevel, pickEffort } from "./modelRules";

describe("isEffortLevel", () => {
  test("accepts the five SDK levels", () => {
    for (const level of ["low", "medium", "high", "xhigh", "max"]) {
      expect(isEffortLevel(level)).toBe(true);
    }
  });

  test("rejects anything else", () => {
    expect(isEffortLevel("turbo")).toBe(false);
    expect(isEffortLevel("")).toBe(false);
    expect(isEffortLevel(undefined)).toBe(false);
    expect(isEffortLevel(3)).toBe(false);
  });
});

describe("pickEffort", () => {
  const levels = ["low", "medium", "high", "xhigh", "max"];

  test("keeps a level the model supports", () => {
    expect(pickEffort(levels, "xhigh")).toBe("xhigh");
  });

  // The backend used to drop xhigh with no error, because its whitelist only
  // knew four levels.
  test("does not drop xhigh when the model lists it", () => {
    expect(pickEffort(["low", "high", "xhigh"], "xhigh")).toBe("xhigh");
  });

  test("moves an unsupported level to the nearest supported one", () => {
    expect(pickEffort(["low", "medium", "high"], "max")).toBe("high");
    expect(pickEffort(["medium", "high"], "low")).toBe("medium");
  });

  test("a tie goes to the lower level", () => {
    // medium is one step from both low and high
    expect(pickEffort(["low", "high"], "medium")).toBe("low");
  });

  test("never returns a level outside the model's list", () => {
    const supported = ["low", "high"];
    for (const requested of ["low", "medium", "high", "xhigh", "max"]) {
      const picked = pickEffort(supported, requested);
      expect(picked).toBeDefined();
      expect(supported.includes(picked ?? "")).toBe(true);
    }
  });

  test("a model with no levels gets none", () => {
    expect(pickEffort([], "high")).toBeUndefined();
    expect(pickEffort(undefined, "high")).toBeUndefined();
  });

  test("nothing requested, or an unknown level, gets none", () => {
    expect(pickEffort(levels, undefined)).toBeUndefined();
    expect(pickEffort(levels, "turbo")).toBeUndefined();
  });

  test("ignores entries in the model's list that are not real levels", () => {
    expect(pickEffort(["low", "bogus"], "high")).toBe("low");
    expect(pickEffort(["bogus"], "high")).toBeUndefined();
  });
});

describe("findModel", () => {
  const models = [
    { id: "claude-sonnet-5" },
    { id: "claude-haiku-4-5-20251001" },
    { id: "claude-opus-5" },
  ];

  test("finds an exact id", () => {
    expect(findModel(models, "claude-opus-5")).toEqual({ id: "claude-opus-5" });
  });

  // Sessions saved from the fallback list hold the undated Haiku id, but the
  // SDK's concrete id carries a date.
  test("matches a saved undated id to the dated row", () => {
    expect(findModel(models, "claude-haiku-4-5")).toEqual({
      id: "claude-haiku-4-5-20251001",
    });
  });

  test("matches a saved dated id to an undated row, the other way round", () => {
    expect(
      findModel([{ id: "claude-haiku-4-5" }], "claude-haiku-4-5-20251001"),
    ).toEqual({ id: "claude-haiku-4-5" });
  });

  test("an exact match wins over a date-suffix match", () => {
    const both = [
      { id: "claude-haiku-4-5-20251001" },
      { id: "claude-haiku-4-5" },
    ];
    expect(findModel(both, "claude-haiku-4-5")).toEqual({
      id: "claude-haiku-4-5",
    });
  });

  test("does not treat a different model as a date variant", () => {
    expect(findModel(models, "claude-sonnet-4")).toBeUndefined();
    expect(findModel(models, "claude-opus")).toBeUndefined();
  });

  test("only an eight-digit suffix counts as a date", () => {
    expect(
      findModel([{ id: "claude-haiku-4-5-2025" }], "claude-haiku-4-5"),
    ).toBeUndefined();
  });

  test("unknown or missing ids find nothing", () => {
    expect(findModel(models, "claude-opus-4-6")).toBeUndefined();
    expect(findModel(models, undefined)).toBeUndefined();
    expect(findModel(models, "")).toBeUndefined();
    expect(findModel([], "claude-opus-5")).toBeUndefined();
  });
});
