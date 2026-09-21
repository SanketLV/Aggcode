import { describe, expect, test } from "bun:test";
import {
  AddMessageSchema,
  CreateSessionSchema,
  CreateWorkspaceSchema,
  GetProviderAuthSchema,
  ProviderLoginSchema,
  ProviderLogoutSchema,
  UpdateSessionConfigSchema,
} from "./incoming";

describe("CreateWorkspaceSchema", () => {
  test("trims the path", () => {
    expect(CreateWorkspaceSchema.parse({ path: "  D:\\code\\app  " })).toEqual({
      path: "D:\\code\\app",
    });
  });

  test("rejects a whitespace-only path", () => {
    expect(CreateWorkspaceSchema.safeParse({ path: "   " }).success).toBe(
      false,
    );
  });

  test("rejects a missing path", () => {
    expect(CreateWorkspaceSchema.safeParse({}).success).toBe(false);
  });
});

describe("CreateSessionSchema", () => {
  test("requires workspaceId as a string", () => {
    expect(CreateSessionSchema.safeParse({ workspaceId: "abc" }).success).toBe(
      true,
    );
    expect(CreateSessionSchema.safeParse({ workspaceId: 1 }).success).toBe(
      false,
    );
  });
});

describe("AddMessageSchema", () => {
  test("accepts the minimal payload and trims the message", () => {
    expect(
      AddMessageSchema.parse({ sessionId: "s1", message: "  hi  " }),
    ).toEqual({
      sessionId: "s1",
      message: "hi",
    });
  });

  // An empty turn would still start an agent run, so the schema is the gate.
  test("rejects a whitespace-only message", () => {
    expect(
      AddMessageSchema.safeParse({ sessionId: "s1", message: " \n " }).success,
    ).toBe(false);
  });

  test("accepts every effort level", () => {
    for (const effort of ["low", "medium", "high", "max"]) {
      expect(
        AddMessageSchema.safeParse({ sessionId: "s1", message: "hi", effort })
          .success,
      ).toBe(true);
    }
  });

  test("rejects an unknown effort level", () => {
    expect(
      AddMessageSchema.safeParse({
        sessionId: "s1",
        message: "hi",
        effort: "extreme",
      }).success,
    ).toBe(false);
  });
});

describe("UpdateSessionConfigSchema", () => {
  test("requires provider", () => {
    expect(
      UpdateSessionConfigSchema.safeParse({ sessionId: "s1" }).success,
    ).toBe(false);
    expect(
      UpdateSessionConfigSchema.safeParse({
        sessionId: "s1",
        provider: "claude",
      }).success,
    ).toBe(true);
  });
});

describe("ProviderLoginSchema", () => {
  test("credentials must be a string-to-string map", () => {
    const base = { providerId: "opencode", method: "api" };
    expect(
      ProviderLoginSchema.safeParse({ ...base, credentials: { key: "x" } })
        .success,
    ).toBe(true);
    expect(
      ProviderLoginSchema.safeParse({ ...base, credentials: { key: 1 } })
        .success,
    ).toBe(false);
  });
});

describe("ProviderLoginSchema required fields", () => {
  test("requires providerId and method", () => {
    expect(ProviderLoginSchema.safeParse({ method: "api_key" }).success).toBe(
      false,
    );
    expect(
      ProviderLoginSchema.safeParse({ providerId: "claude" }).success,
    ).toBe(false);
  });

  test("credentials are optional (OAuth sends none)", () => {
    expect(
      ProviderLoginSchema.safeParse({ providerId: "claude", method: "oauth" })
        .success,
    ).toBe(true);
  });
});

describe("ProviderLogoutSchema", () => {
  test("target is optional: omitting it means every provider Aggcode owns", () => {
    expect(ProviderLogoutSchema.parse({ providerId: "opencode" })).toEqual({
      providerId: "opencode",
    });
    expect(
      ProviderLogoutSchema.parse({ providerId: "opencode", target: "openai" }),
    ).toEqual({ providerId: "opencode", target: "openai" });
  });

  test("rejects a missing providerId or non-string target", () => {
    expect(ProviderLogoutSchema.safeParse({}).success).toBe(false);
    expect(
      ProviderLogoutSchema.safeParse({ providerId: "opencode", target: 1 })
        .success,
    ).toBe(false);
  });
});

describe("GetProviderAuthSchema", () => {
  test("accepts an empty payload", () => {
    expect(GetProviderAuthSchema.safeParse({}).success).toBe(true);
  });

  test("rejects a non-string providerId", () => {
    expect(GetProviderAuthSchema.safeParse({ providerId: 5 }).success).toBe(
      false,
    );
  });
});
