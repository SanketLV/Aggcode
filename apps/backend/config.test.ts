import { describe, expect, test } from "bun:test";
import { isLoopbackHost, resolveServerConfig } from "./config";

describe("resolveServerConfig", () => {
  test("defaults to loopback on 3000", () => {
    expect(resolveServerConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3000,
    });
  });

  test("reads a custom host and port", () => {
    expect(
      resolveServerConfig({ AGGCODE_HOST: "0.0.0.0", AGGCODE_PORT: "4100" }),
    ).toEqual({ host: "0.0.0.0", port: 4100 });
  });

  test("AGGCODE_PORT=0 means let the OS pick", () => {
    expect(resolveServerConfig({ AGGCODE_PORT: "0" }).port).toBe(0);
  });

  test("an invalid port throws naming AGGCODE_PORT", () => {
    expect(() => resolveServerConfig({ AGGCODE_PORT: "abc" })).toThrow(
      /AGGCODE_PORT/,
    );
  });
});

describe("isLoopbackHost", () => {
  test.each(["127.0.0.1", "::1", "localhost"])("%s is loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  test.each(["0.0.0.0", "192.168.1.5", "::"])("%s is not loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
