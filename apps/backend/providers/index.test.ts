import { describe, expect, mock, test } from "bun:test";
import * as realChildProcess from "child_process";
import * as realClaude from "./claude";

// Record every shell command the providers run, and answer the status check
// as a logged-in CLI. A real `claude auth logout` would sign the whole machine
// out, so the test must be able to prove it is never issued.
const commands: string[] = [];
mock.module("child_process", () => ({
  ...realChildProcess,
  exec: (
    cmd: string,
    _opts: unknown,
    cb: (err: Error | null, stdout: string) => void,
  ) => {
    commands.push(cmd);
    cb(null, JSON.stringify({ loggedIn: true, email: "dev@example.com" }));
  },
  spawn: (cmd: string, args: string[]) => {
    commands.push([cmd, ...args].join(" "));
    return { unref() {} };
  },
}));

// Reading the catalog starts a background fetch, which would start a real
// Claude Code process. Answer it from the test instead.
let modelFetch: () => Promise<unknown[]> = () => new Promise(() => {});
mock.module("./claude", () => ({
  ...realClaude,
  fetchSupportedModels: () => modelFetch(),
}));

const {
  CLAUDE_CATALOG,
  findProvider,
  getClaudeCatalog,
  getProvider,
  invalidateClaudeCatalog,
  resolveModel,
} = await import("./index");

describe("findProvider", () => {
  test("returns registered providers", () => {
    expect(findProvider("claude")?.id).toBe("claude");
    expect(findProvider("OpenCode")?.id).toBe("opencode");
  });

  test("returns undefined for an unknown id instead of falling back to Claude", () => {
    expect(findProvider("doesnotexist")).toBeUndefined();
    // getProvider keeps its fallback for chat routing.
    expect(getProvider("doesnotexist").id).toBe("claude");
  });
});

describe("Claude model catalog", () => {
  // Each id was confirmed against the SDK with a real run on 2026-09-21;
  // claude-3-7-sonnet / claude-3-5-* were rejected as unknown models.
  test("offers only model ids the agent SDK accepts", () => {
    const claude = CLAUDE_CATALOG;
    expect(claude.models.map((m) => m.id)).toEqual([
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-haiku-4-5",
      "claude-opus-4-6",
    ]);
    expect(claude.defaultModel).toBe("claude-sonnet-5");
  });
});

describe("resolveModel", () => {
  const option = {
    id: "claude",
    name: "Claude Code",
    defaultModel: "claude-sonnet-5",
    models: [
      { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
      { id: "claude-opus-5", name: "Claude Opus 5" },
    ],
  };

  test("keeps a model the catalog offers", () => {
    expect(resolveModel(option, "claude-opus-5")).toBe("claude-opus-5");
  });

  test("replaces a retired model saved on an old session with the default", () => {
    expect(resolveModel(option, "claude-3-7-sonnet")).toBe("claude-sonnet-5");
  });

  test("uses the default when nothing was requested", () => {
    expect(resolveModel(option, undefined)).toBe("claude-sonnet-5");
  });

  test("passes the request through when the provider has no catalog entry", () => {
    expect(resolveModel(undefined, "anything")).toBe("anything");
  });

  // Sessions saved from the built-in list hold the undated Haiku id; the SDK's
  // concrete id carries a date.
  test("keeps a saved Haiku session on Haiku when the live id is dated", () => {
    const live = {
      ...option,
      models: [
        ...option.models,
        { id: "claude-haiku-4-5-20251001", name: "Haiku" },
      ],
    };
    expect(resolveModel(live, "claude-haiku-4-5")).toBe(
      "claude-haiku-4-5-20251001",
    );
  });
});

describe("Claude live catalog", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("serves the built-in catalog until the live list lands", async () => {
    let land!: (rows: unknown[]) => void;
    modelFetch = () => new Promise((resolve) => (land = resolve));
    invalidateClaudeCatalog();

    expect(getClaudeCatalog()).toBe(CLAUDE_CATALOG);

    land([
      {
        value: "opus",
        resolvedModel: "claude-opus-5",
        displayName: "Opus",
        supportsEffort: true,
        supportedEffortLevels: ["low", "xhigh"],
      },
    ]);
    await flush();

    // The live row leads. The built-in models the SDK did not list stay after
    // it, because a run showed the SDK still accepts them.
    const live = getClaudeCatalog();
    expect(live.models.map((m) => m.id)).toEqual([
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-opus-4-6",
    ]);
    expect(live.models[0]?.effortLevels).toEqual(["low", "xhigh"]);
  });

  test("a failed fetch keeps serving the built-in catalog", async () => {
    modelFetch = () => Promise.reject(new Error("claude: command not found"));
    invalidateClaudeCatalog();
    await flush();

    expect(getClaudeCatalog()).toBe(CLAUDE_CATALOG);
  });
});

describe("Claude sign-out", () => {
  test("never runs `claude auth logout`", async () => {
    const claude = findProvider("claude");
    const result = await claude?.auth?.logout();
    expect(commands.some((c) => c.includes("logout"))).toBe(false);
    expect(result?.success).toBe(true);
    expect(result?.message).toContain("claude auth logout");
  });
});
