import { describe, expect, test } from "bun:test";
import type { ProviderAuthStatus } from "commons/types";
import {
  buildAuthSnapshot,
  chatGateRejection,
  isValidSubProviderId,
  memoizeAsync,
  planOpenCodeLogout,
} from "./authScope";

function fakeProvider(
  id: string,
  status: () => Promise<ProviderAuthStatus>,
  counter?: { calls: number },
) {
  return {
    id,
    name: id.toUpperCase(),
    auth: {
      getAuthMethods: () => [
        { id: "api_key", label: "Key", type: "api_key" as const },
      ],
      getAuthStatus: async () => {
        if (counter) counter.calls++;
        return status();
      },
      login: async () => ({ success: true }),
      logout: async () => ({ success: true }),
    },
  };
}

describe("memoizeAsync", () => {
  test("concurrent callers share one in-flight call", async () => {
    let calls = 0;
    const memo = memoizeAsync(
      async () => {
        calls++;
        await Bun.sleep(20);
        return calls;
      },
      { ttlMs: 1000 },
    );
    const results = await Promise.all([memo.get(), memo.get(), memo.get()]);
    expect(results).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
  });

  test("serves the cached value until the TTL passes", async () => {
    let clock = 0;
    let calls = 0;
    const memo = memoizeAsync(async () => ++calls, {
      ttlMs: 100,
      now: () => clock,
    });
    expect(await memo.get()).toBe(1);
    clock = 99;
    expect(await memo.get()).toBe(1);
    clock = 100;
    expect(await memo.get()).toBe(2);
  });

  test("does not cache a result rejected by shouldCache", async () => {
    let calls = 0;
    const memo = memoizeAsync(async () => ++calls, {
      ttlMs: 1000,
      shouldCache: (v) => v > 1,
    });
    expect(await memo.get()).toBe(1);
    expect(await memo.get()).toBe(2);
    expect(await memo.get()).toBe(2);
  });

  test("invalidate forces a fresh call", async () => {
    let calls = 0;
    const memo = memoizeAsync(async () => ++calls, { ttlMs: 1000 });
    await memo.get();
    memo.invalidate();
    expect(await memo.get()).toBe(2);
  });

  test("a rejected call is not cached", async () => {
    let calls = 0;
    const memo = memoizeAsync(
      async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return calls;
      },
      { ttlMs: 1000 },
    );
    await expect(memo.get()).rejects.toThrow("boom");
    expect(await memo.get()).toBe(2);
  });
});

describe("planOpenCodeLogout", () => {
  test("no target removes only what Aggcode connected", () => {
    expect(planOpenCodeLogout(["openrouter", "openai"])).toEqual({
      remove: ["openrouter", "openai"],
      notOwned: [],
    });
  });

  test("a target Aggcode connected is removed", () => {
    expect(planOpenCodeLogout(["openrouter", "openai"], "OpenAI")).toEqual({
      remove: ["openai"],
      notOwned: [],
    });
  });

  test("a target connected outside Aggcode is refused, never removed", () => {
    expect(planOpenCodeLogout(["openrouter"], "anthropic")).toEqual({
      remove: [],
      notOwned: ["anthropic"],
    });
  });

  test("nothing connected by Aggcode means nothing to remove", () => {
    expect(planOpenCodeLogout([])).toEqual({ remove: [], notOwned: [] });
  });
});

describe("isValidSubProviderId", () => {
  test("accepts plain provider ids", () => {
    for (const id of ["openrouter", "openai", "deep-seek", "x_ai", "gpt4"]) {
      expect(isValidSubProviderId(id)).toBe(true);
    }
  });

  test("rejects ids that would break a Mongo map key or a URL path", () => {
    for (const id of ["", "a.b", "$set", "a/b", "../x", "a b"]) {
      expect(isValidSubProviderId(id)).toBe(false);
    }
  });
});

describe("chatGateRejection", () => {
  test("lets a signed-in provider through", async () => {
    const p = fakeProvider("claude", async () => ({
      providerId: "claude",
      isAuthenticated: true,
    }));
    expect(await chatGateRejection(p)).toBeNull();
  });

  test("lets a provider without auth through", async () => {
    expect(await chatGateRejection({ id: "x", name: "X" })).toBeNull();
  });

  test("blocks a signed-out provider without inventing a provider count", async () => {
    const p = fakeProvider("opencode", async () => ({
      providerId: "opencode",
      isAuthenticated: false,
    }));
    const msg = await chatGateRejection(p);
    expect(msg).toContain("Not signed in to OPENCODE");
    expect(msg).not.toContain("0 provider");
  });

  // Fail closed: an erroring check used to fall through and start the run.
  test("blocks when the status check itself throws", async () => {
    const p = fakeProvider("claude", async () => {
      throw new Error("cli missing");
    });
    const msg = await chatGateRejection(p);
    expect(msg).toContain("Could not check the sign-in for CLAUDE");
    expect(msg).toContain("cli missing");
  });
});

describe("buildAuthSnapshot", () => {
  test("checks each provider's status exactly once for both views", async () => {
    const a = { calls: 0 };
    const b = { calls: 0 };
    const snap = await buildAuthSnapshot([
      fakeProvider(
        "claude",
        async () => ({ providerId: "claude", isAuthenticated: true }),
        a,
      ),
      fakeProvider(
        "opencode",
        async () => ({ providerId: "opencode", isAuthenticated: false }),
        b,
      ),
    ]);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
    expect(snap.statuses.claude?.isAuthenticated).toBe(true);
    expect(
      snap.descriptors.map((d) => [d.id, d.status.isAuthenticated]),
    ).toEqual([
      ["claude", true],
      ["opencode", false],
    ]);
  });

  test("runs the checks in parallel", async () => {
    const slow = async () => {
      await Bun.sleep(100);
      return { providerId: "p", isAuthenticated: true };
    };
    const t = Date.now();
    await buildAuthSnapshot([fakeProvider("a", slow), fakeProvider("b", slow)]);
    expect(Date.now() - t).toBeLessThan(180);
  });

  test("a failing check marks only that provider signed out", async () => {
    const snap = await buildAuthSnapshot([
      fakeProvider("claude", async () => {
        throw new Error("boom");
      }),
      fakeProvider("opencode", async () => ({
        providerId: "opencode",
        isAuthenticated: true,
      })),
    ]);
    expect(snap.statuses.claude?.isAuthenticated).toBe(false);
    expect(snap.statuses.claude?.details).toContain("boom");
    expect(snap.statuses.opencode?.isAuthenticated).toBe(true);
  });

  test("a provider without auth counts as signed in with no methods", async () => {
    const snap = await buildAuthSnapshot([{ id: "local", name: "Local" }]);
    expect(snap.statuses.local?.isAuthenticated).toBe(true);
    expect(snap.descriptors[0]?.authMethods).toEqual([]);
  });
});
