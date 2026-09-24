import { afterEach, describe, expect, mock, test } from "bun:test";
import os from "node:os";
import * as realSdk from "@anthropic-ai/claude-agent-sdk";

type FakeQuery = {
  supportedModels: () => Promise<unknown[]>;
  close: () => void;
};
type QueryArgs = { prompt: unknown; options: Record<string, unknown> };

let makeQuery: (args: QueryArgs) => FakeQuery = () => {
  throw new Error("no fake query installed");
};
const queries: QueryArgs[] = [];

// Spread the real module so unrelated imports from it still load.
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  ...realSdk,
  query: (args: QueryArgs) => {
    queries.push(args);
    return makeQuery(args);
  },
}));

const { fetchSupportedModels } = await import("./claude");

afterEach(() => {
  queries.length = 0;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("fetchSupportedModels", () => {
  test("returns the rows and closes the process", async () => {
    let closed = 0;
    makeQuery = () => ({
      supportedModels: async () => [{ value: "sonnet", displayName: "Sonnet" }],
      close: () => {
        closed++;
      },
    });

    const rows = await fetchSupportedModels();
    expect(rows).toEqual([{ value: "sonnet", displayName: "Sonnet" }]);
    expect(closed).toBe(1);
  });

  // An unclosed query leaves a Claude Code process running per failed fetch.
  test("closes the process when the SDK call fails", async () => {
    let closed = 0;
    makeQuery = () => ({
      supportedModels: async () => {
        throw new Error("not signed in");
      },
      close: () => {
        closed++;
      },
    });

    await expect(fetchSupportedModels()).rejects.toThrow("not signed in");
    expect(closed).toBe(1);
  });

  test("gives up after the timeout, and still closes the process", async () => {
    let closed = 0;
    makeQuery = () => ({
      supportedModels: () => new Promise(() => {}),
      close: () => {
        closed++;
      },
    });

    await expect(fetchSupportedModels(20)).rejects.toThrow(/timed out/i);
    expect(closed).toBe(1);
  });

  test("cancelling stops the wait and closes the process", async () => {
    let closed = 0;
    makeQuery = () => ({
      supportedModels: () => new Promise(() => {}),
      close: () => {
        closed++;
      },
    });

    const controller = new AbortController();
    const pending = fetchSupportedModels(60_000, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow(/cancel/i);
    expect(closed).toBe(1);
  });

  test("an already-cancelled signal never starts a process", async () => {
    makeQuery = () => {
      throw new Error("a process was started");
    };
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchSupportedModels(60_000, controller.signal),
    ).rejects.toThrow(/cancel/i);
    expect(queries).toHaveLength(0);
  });

  test("never sends a prompt, so no message reaches a model", async () => {
    makeQuery = () => ({
      supportedModels: async () => [{ value: "x", displayName: "X" }],
      close: () => {},
    });
    await fetchSupportedModels();

    const { prompt } = queries[0] as QueryArgs;
    expect(typeof prompt).not.toBe("string");
    const iterator = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const first = await Promise.race([
      iterator.next(),
      sleep(30).then(() => "still waiting"),
    ]);
    expect(first).toBe("still waiting");
  });

  test("runs outside the project, so its settings and CLAUDE.md are not loaded", async () => {
    makeQuery = () => ({
      supportedModels: async () => [{ value: "x", displayName: "X" }],
      close: () => {},
    });
    await fetchSupportedModels();
    expect(queries[0]?.options.cwd).toBe(os.tmpdir());
  });

  // A user signed in with an API key would otherwise ask as nobody.
  test("passes the API key the runs use", async () => {
    const before = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    makeQuery = () => ({
      supportedModels: async () => [{ value: "x", displayName: "X" }],
      close: () => {},
    });
    try {
      await fetchSupportedModels();
      const env = queries[0]?.options.env as Record<string, string>;
      expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    } finally {
      if (before === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = before;
      }
    }
  });
});
