import { describe, expect, test } from "bun:test";
import { composerHint, composerPlaceholder } from "./composer";

describe("composerPlaceholder", () => {
  // The old string spliced the status details in, producing
  // "Sign in to Not signed in. Connect a provider ... to chat".
  test("signed out names the provider, not its status text", () => {
    expect(
      composerPlaceholder({
        signedIn: false,
        working: false,
        providerName: "OpenCode",
        workspaceName: "aggcode",
      }),
    ).toBe("Sign in to OpenCode to start chatting");
  });

  test("signed out wins over working", () => {
    expect(
      composerPlaceholder({
        signedIn: false,
        working: true,
        providerName: "Claude Code",
        workspaceName: "aggcode",
      }),
    ).toBe("Sign in to Claude Code to start chatting");
  });

  test("working", () => {
    expect(
      composerPlaceholder({
        signedIn: true,
        working: true,
        providerName: "Claude Code",
        workspaceName: "aggcode",
      }),
    ).toBe("Claude Code is working on this session…");
  });

  test("ready names the workspace", () => {
    expect(
      composerPlaceholder({
        signedIn: true,
        working: false,
        providerName: "Claude Code",
        workspaceName: "aggcode",
      }),
    ).toBe("Ask Claude Code to change something in aggcode…");
  });
});

describe("composerHint", () => {
  const base = {
    online: true,
    signedIn: true,
    working: false,
    providerName: "Claude Code",
    authDetails: undefined,
  };

  test("ready shows the keyboard hint", () => {
    expect(composerHint(base)).toEqual({
      text: "Enter to send · Shift+Enter for a new line",
      tone: "muted",
    });
  });

  // Offline blocks everything, so it outranks every other reason.
  test("offline wins over signed out and working", () => {
    expect(
      composerHint({ ...base, online: false, signedIn: false, working: true }),
    ).toEqual({
      text: "Disconnected from the server, so messages can't be saved.",
      tone: "muted",
    });
  });

  test("signed out uses the provider's own details when it has them", () => {
    expect(
      composerHint({
        ...base,
        signedIn: false,
        authDetails: "Free models are disabled when signed out.",
      }),
    ).toEqual({
      text: "Free models are disabled when signed out.",
      tone: "warning",
    });
  });

  test("signed out without details names the provider", () => {
    expect(composerHint({ ...base, signedIn: false })).toEqual({
      text: "Not signed in to Claude Code. Sign in to send messages.",
      tone: "warning",
    });
  });

  test("signed out wins over working", () => {
    expect(
      composerHint({ ...base, signedIn: false, working: true }).tone,
    ).toBe("warning");
  });

  test("working", () => {
    expect(composerHint({ ...base, working: true })).toEqual({
      text: "One turn at a time per session.",
      tone: "muted",
    });
  });
});
