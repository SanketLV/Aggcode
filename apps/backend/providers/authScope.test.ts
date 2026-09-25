import { describe, expect, test } from "bun:test";
import type { ProviderAuthStatus } from "commons/types";
import {
  buildAuthSnapshot,
  chatGateRejection,
  connectWithOwnership,
  isValidSubProviderId,
  memoizeAsync,
  planOpenCodeLogout,
  resolveOpenCodeStatus,
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
  test("no target removes only what Aggcode connected, and ends the opt-in", () => {
    expect(planOpenCodeLogout(["openrouter", "openai"])).toEqual({
      remove: ["openrouter", "openai"],
      notOwned: [],
      clearOptIn: true,
    });
  });

  test("a target Aggcode connected is removed, and the opt-in stays", () => {
    expect(planOpenCodeLogout(["openrouter", "openai"], "OpenAI")).toEqual({
      remove: ["openai"],
      notOwned: [],
      clearOptIn: false,
    });
  });

  test("a target connected outside Aggcode is refused, never removed", () => {
    expect(planOpenCodeLogout(["openrouter"], "anthropic")).toEqual({
      remove: [],
      notOwned: ["anthropic"],
      clearOptIn: false,
    });
  });

  test("nothing connected by Aggcode still ends the opt-in", () => {
    expect(planOpenCodeLogout([])).toEqual({
      remove: [],
      notOwned: [],
      clearOptIn: true,
    });
  });
});

describe("resolveOpenCodeStatus", () => {
  test("opting in to OpenCode as installed is enough to sign in", () => {
    const status = resolveOpenCodeStatus({
      externalConnected: [],
      optedIn: true,
    });
    expect(status.providerId).toBe("opencode");
    expect(status.isAuthenticated).toBe(true);
    expect(status.method).toBe("local");
    expect(status.details).toContain("free models");
    expect(status.connectedSubProviders).toBeUndefined();
  });

  test("a connected provider signs in without the opt-in", () => {
    const status = resolveOpenCodeStatus({
      externalConnected: ["openrouter", "openai"],
      optedIn: false,
    });
    expect(status.isAuthenticated).toBe(true);
    expect(status.method).toBe("api_key");
    expect(status.accountName).toBe("openrouter, openai");
    expect(status.details).toBe("Connected 2 providers: openrouter, openai");
    expect(status.connectedSubProviders).toEqual(["openrouter", "openai"]);
  });

  test("one connected provider is described in the singular", () => {
    const status = resolveOpenCodeStatus({
      externalConnected: ["openrouter"],
      optedIn: false,
    });
    expect(status.details).toBe("Connected 1 provider: openrouter");
  });

  test("with both, the connected providers are named", () => {
    const status = resolveOpenCodeStatus({
      externalConnected: ["openrouter"],
      optedIn: true,
    });
    expect(status.isAuthenticated).toBe(true);
    expect(status.connectedSubProviders).toEqual(["openrouter"]);
  });

  test("neither is not signed in, and says how to fix that", () => {
    const status = resolveOpenCodeStatus({
      externalConnected: [],
      optedIn: false,
    });
    expect(status.isAuthenticated).toBe(false);
    expect(status.method).toBe("none");
    expect(status.accountName).toBe("Not signed in");
    expect(status.details).toContain("as installed");
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

describe("connectWithOwnership", () => {
  const ok = async () => {};
  const fail = (msg: string) => async () => {
    throw new Error(msg);
  };

  test("records ownership after OpenCode accepts the key", async () => {
    const calls: string[] = [];
    const res = await connectWithOwnership({
      setKey: async () => void calls.push("set"),
      recordOwner: async () => void calls.push("record"),
      removeKey: async () => void calls.push("remove"),
    });
    expect(res).toEqual({ ok: true });
    expect(calls).toEqual(["set", "record"]);
  });

  test("a rejected key records nothing", async () => {
    const calls: string[] = [];
    const res = await connectWithOwnership({
      setKey: fail("bad key"),
      recordOwner: async () => void calls.push("record"),
      removeKey: async () => void calls.push("remove"),
    });
    expect(res).toEqual({ ok: false, reason: "set-failed", error: "bad key" });
    expect(calls).toEqual([]);
  });

  // Otherwise the key stays in OpenCode with no marker, and Aggcode's own
  // sign-out would refuse to remove it.
  test("a failed ownership write rolls the key back out of OpenCode", async () => {
    const calls: string[] = [];
    const res = await connectWithOwnership({
      setKey: ok,
      recordOwner: fail("mongo down"),
      removeKey: async () => void calls.push("remove"),
    });
    expect(calls).toEqual(["remove"]);
    expect(res).toEqual({
      ok: false,
      reason: "rolled-back",
      error: "mongo down",
    });
  });

  test("reports a key left behind when the rollback also fails", async () => {
    const res = await connectWithOwnership({
      setKey: ok,
      recordOwner: fail("mongo down"),
      removeKey: fail("opencode down"),
    });
    expect(res).toEqual({
      ok: false,
      reason: "orphaned",
      error: "mongo down",
    });
  });
});
