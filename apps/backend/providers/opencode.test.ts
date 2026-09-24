import { describe, expect, test } from "bun:test";
import { OpenCodeProvider } from "./opencode";

describe("OpenCode auth methods", () => {
  const methods = new OpenCodeProvider().auth.getAuthMethods();

  test("offers use-as-installed first, then the API key method", () => {
    expect(methods.map((m) => m.id)).toEqual(["local", "connect"]);
  });

  test("use-as-installed asks for nothing", () => {
    const local = methods.find((m) => m.id === "local");
    expect(local?.type).toBe("none");
    expect(local?.fields ?? []).toEqual([]);
  });

  test("the API key method still asks for a provider id and a key", () => {
    const connect = methods.find((m) => m.id === "connect");
    expect(connect?.type).toBe("api_key");
    expect(connect?.fields?.map((f) => f.id)).toEqual([
      "subProvider",
      "apiKey",
    ]);
  });
});
