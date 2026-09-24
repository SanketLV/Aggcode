import { describe, expect, test } from "bun:test";
import { loadSocketConfig, parseSocketConfig } from "./socketConfig";

describe("parseSocketConfig", () => {
  test("accepts a valid shape", () => {
    expect(parseSocketConfig({ wsUrl: "ws://127.0.0.1:3000" })).toEqual({
      wsUrl: "ws://127.0.0.1:3000",
    });
  });

  test.each([
    undefined,
    null,
    {},
    { wsUrl: 3000 },
    { wsUrl: null },
    "ws://127.0.0.1:3000",
  ])("rejects %p", (value) => {
    expect(() => parseSocketConfig(value)).toThrow();
  });
});

describe("loadSocketConfig", () => {
  test("prefers window.__AGGCODE_CONFIG__ and never calls fetch", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      throw new Error("should not be called");
    };

    const result = await loadSocketConfig({
      windowConfig: { wsUrl: "ws://127.0.0.1:4100" },
      fetchImpl,
    });

    expect(result).toEqual({ wsUrl: "ws://127.0.0.1:4100" });
    expect(called).toBe(false);
  });

  test("falls back to fetching /api/config", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ wsUrl: "ws://127.0.0.1:3000" }), {
        status: 200,
      });

    const result = await loadSocketConfig({
      windowConfig: undefined,
      fetchImpl,
    });

    expect(result).toEqual({ wsUrl: "ws://127.0.0.1:3000" });
  });

  test("rejects on a network error", async () => {
    const fetchImpl = async () => {
      throw new TypeError("network error");
    };

    await expect(
      loadSocketConfig({ windowConfig: undefined, fetchImpl }),
    ).rejects.toThrow();
  });

  test("rejects on a non-200 response", async () => {
    const fetchImpl = async () => new Response("nope", { status: 500 });

    await expect(
      loadSocketConfig({ windowConfig: undefined, fetchImpl }),
    ).rejects.toThrow();
  });

  test("rejects on an HTML error page", async () => {
    const fetchImpl = async () =>
      new Response("<html>404</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    await expect(
      loadSocketConfig({ windowConfig: undefined, fetchImpl }),
    ).rejects.toThrow();
  });

  test("rejects on an empty JSON object", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({}), { status: 200 });

    await expect(
      loadSocketConfig({ windowConfig: undefined, fetchImpl }),
    ).rejects.toThrow();
  });
});
