import { describe, expect, test } from "bun:test";
import { effortOptions, shownEffort } from "./effort";

const full = {
  id: "claude-opus-5",
  name: "Opus",
  supportsEffort: true,
  effortLevels: ["low", "medium", "high", "xhigh", "max"],
};

describe("effortOptions", () => {
  test("offers the levels the model lists, weakest first, with labels", () => {
    expect(effortOptions(full)).toEqual([
      { value: "low", label: "Low effort" },
      { value: "medium", label: "Medium effort" },
      { value: "high", label: "High effort" },
      { value: "xhigh", label: "Extra high effort" },
      { value: "max", label: "Max effort" },
    ]);
  });

  test("puts levels in order even when the model lists them out of order", () => {
    const shuffled = { ...full, effortLevels: ["max", "low", "high"] };
    expect(effortOptions(shuffled).map((o) => o.value)).toEqual([
      "low",
      "high",
      "max",
    ]);
  });

  // OpenCode's reasoning models report no levels, and the picker used to
  // offer exactly these four for every model.
  test("a model that supports effort but lists no levels gets the usual four", () => {
    const legacy = { id: "x", name: "X", supportsEffort: true };
    expect(effortOptions(legacy).map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
  });

  test("a model without effort support offers none", () => {
    expect(
      effortOptions({ id: "haiku", name: "Haiku", supportsEffort: false }),
    ).toEqual([]);
    expect(effortOptions({ id: "haiku", name: "Haiku" })).toEqual([]);
  });

  test("no model offers none", () => {
    expect(effortOptions(undefined)).toEqual([]);
  });

  test("skips a level the UI has no label for", () => {
    const odd = { ...full, effortLevels: ["low", "turbo", "high"] };
    expect(effortOptions(odd).map((o) => o.value)).toEqual(["low", "high"]);
  });
});

describe("shownEffort", () => {
  test("shows a saved level the model supports", () => {
    expect(shownEffort(full, "xhigh")).toBe("xhigh");
  });

  // What the backend will actually send, so the picker never claims a level
  // that will not run.
  test("shows the nearest supported level when the saved one is not offered", () => {
    const limited = { ...full, effortLevels: ["low", "medium", "high"] };
    expect(shownEffort(limited, "max")).toBe("high");
  });

  test("defaults to high when nothing was saved", () => {
    expect(shownEffort(full, undefined)).toBe("high");
  });

  test("defaults to the nearest level to high when the model has no high", () => {
    const noHigh = { ...full, effortLevels: ["medium", "max"] };
    expect(shownEffort(noHigh, undefined)).toBe("medium");
  });

  // low and max are both two steps from high; the shared rule takes the lower.
  test("a tie between two levels goes to the lower one", () => {
    const noHigh = { ...full, effortLevels: ["low", "max"] };
    expect(shownEffort(noHigh, undefined)).toBe("low");
  });

  test("a model without effort support shows none", () => {
    expect(
      shownEffort(
        { id: "haiku", name: "Haiku", supportsEffort: false },
        "high",
      ),
    ).toBeUndefined();
    expect(shownEffort(undefined, "high")).toBeUndefined();
  });
});
