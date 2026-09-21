import { describe, expect, test } from "bun:test";
import { composerPlaceholder } from "./composer";

describe("composerPlaceholder", () => {
  // The old string spliced the status details in, producing
  // "Sign in to Not signed in. Connect a provider ... to chat".
  test("signed out names the provider, not its status text", () => {
    expect(
      composerPlaceholder({
        signedIn: false,
        working: false,
        providerName: "OpenCode",
      }),
    ).toBe("Sign in to OpenCode to chat");
  });

  test("signed out wins over working", () => {
    expect(
      composerPlaceholder({
        signedIn: false,
        working: true,
        providerName: "Claude Code",
      }),
    ).toBe("Sign in to Claude Code to chat");
  });

  test("working", () => {
    expect(
      composerPlaceholder({
        signedIn: true,
        working: true,
        providerName: "Claude Code",
      }),
    ).toBe("Waiting for the agent");
  });

  test("ready", () => {
    expect(
      composerPlaceholder({
        signedIn: true,
        working: false,
        providerName: "Claude Code",
      }),
    ).toBe("Send a message");
  });
});
