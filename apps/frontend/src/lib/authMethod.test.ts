import { describe, expect, test } from "bun:test";
import { methodKind } from "./authMethod";

describe("methodKind", () => {
  test("a method with fields is a form", () => {
    expect(
      methodKind({
        id: "connect",
        label: "API key",
        type: "api_key",
        fields: [{ id: "apiKey", label: "Key", type: "password" }],
      }),
    ).toBe("fields");
  });

  test("an oauth method opens the browser", () => {
    expect(methodKind({ id: "oauth", label: "Browser", type: "oauth" })).toBe(
      "oauth",
    );
  });

  // The modal used to render only a note for this shape, with no button, so a
  // method that needs nothing could not be chosen.
  test("a method with no fields and no browser step is one click", () => {
    expect(
      methodKind({ id: "local", label: "As installed", type: "none" }),
    ).toBe("direct");
  });

  test("an empty field list counts as no fields", () => {
    expect(
      methodKind({
        id: "local",
        label: "As installed",
        type: "none",
        fields: [],
      }),
    ).toBe("direct");
  });

  test("fields win over the type", () => {
    expect(
      methodKind({
        id: "x",
        label: "X",
        type: "oauth",
        fields: [{ id: "a", label: "A", type: "text" }],
      }),
    ).toBe("fields");
  });
});
