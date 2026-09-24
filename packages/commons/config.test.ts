import { describe, expect, test } from "bun:test";
import { parsePort } from "./config";

describe("parsePort", () => {
  test("empty string falls back to the default", () => {
    expect(parsePort("", "AGGCODE_PORT", 3000)).toBe(3000);
    expect(parsePort(undefined, "AGGCODE_PORT", 3000)).toBe(3000);
  });

  test.each([
    ["0", 0],
    ["3000", 3000],
    ["65535", 65535],
  ])("accepts %s", (value, expected) => {
    expect(parsePort(value, "AGGCODE_PORT", 3000)).toBe(expected);
  });

  test.each(["abc", "3000.5", "-1", "65536", " 80 ", "80x"])(
    "rejects %s",
    (value) => {
      expect(() => parsePort(value, "AGGCODE_PORT", 3000)).toThrow(
        /AGGCODE_PORT/,
      );
      // The bad value itself is in the message so the user can see what they typed.
      expect(() => parsePort(value, "AGGCODE_PORT", 3000)).toThrow(
        new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    },
  );
});
