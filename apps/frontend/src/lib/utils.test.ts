import { describe, expect, test } from "bun:test";
import { cn } from "./utils";

describe("cn", () => {
  // Stock tailwind-merge reads `text-ui` as a colour and drops it when a
  // real colour follows, so the design system's sizes vanished from every
  // primitive that merges classes.
  test.each(["text-micro", "text-ui", "text-title", "text-display"])(
    "keeps %s next to a text colour",
    (size) => {
      expect(cn(size, "text-primary-foreground")).toBe(
        `${size} text-primary-foreground`,
      );
    },
  );

  test("a later custom size still replaces an earlier one", () => {
    expect(cn("text-ui", "text-xs")).toBe("text-xs");
    expect(cn("text-sm", "text-micro")).toBe("text-micro");
  });
});
