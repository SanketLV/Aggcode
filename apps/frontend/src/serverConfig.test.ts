import { describe, expect, test } from "bun:test";
import { buildSocketConfig, resolveWebPort } from "./serverConfig";

describe("buildSocketConfig", () => {
  test("defaults to ws://127.0.0.1:3000", () => {
    expect(buildSocketConfig({})).toEqual({ wsUrl: "ws://127.0.0.1:3000" });
  });

  test("AGGCODE_PORT moves the port", () => {
    expect(buildSocketConfig({ AGGCODE_PORT: "4100" })).toEqual({
      wsUrl: "ws://127.0.0.1:4100",
    });
  });

  test("AGGCODE_BACKEND_URL wins over AGGCODE_PORT", () => {
    expect(
      buildSocketConfig({
        AGGCODE_BACKEND_URL: "ws://192.168.1.5:9000",
        AGGCODE_PORT: "4100",
      }),
    ).toEqual({ wsUrl: "ws://192.168.1.5:9000" });
  });

  test("accepts a wss:// backend URL", () => {
    expect(
      buildSocketConfig({ AGGCODE_BACKEND_URL: "wss://example.com:443" }),
    ).toEqual({ wsUrl: "wss://example.com:443" });
  });

  test("rejects a non ws(s):// backend URL", () => {
    expect(() =>
      buildSocketConfig({ AGGCODE_BACKEND_URL: "http://example.com" }),
    ).toThrow(/AGGCODE_BACKEND_URL/);
  });

  // AGGCODE_PORT=0 asks the OS for a free port, which only the backend
  // process can learn. The frontend server has no way to know it.
  test("AGGCODE_PORT=0 throws pointing at AGGCODE_BACKEND_URL", () => {
    expect(() => buildSocketConfig({ AGGCODE_PORT: "0" })).toThrow(
      /AGGCODE_BACKEND_URL/,
    );
  });

  test("an invalid AGGCODE_PORT throws naming it", () => {
    expect(() => buildSocketConfig({ AGGCODE_PORT: "abc" })).toThrow(
      /AGGCODE_PORT/,
    );
  });
});

describe("resolveWebPort", () => {
  test("defaults to 3001", () => {
    expect(resolveWebPort({})).toBe(3001);
  });

  test("honours AGGCODE_WEB_PORT", () => {
    expect(resolveWebPort({ AGGCODE_WEB_PORT: "3101" })).toBe(3101);
  });

  test("an invalid value throws naming AGGCODE_WEB_PORT", () => {
    expect(() => resolveWebPort({ AGGCODE_WEB_PORT: "abc" })).toThrow(
      /AGGCODE_WEB_PORT/,
    );
  });
});
