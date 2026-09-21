import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  decryptSecret,
  encryptSecret,
  loadOrCreateKey,
} from "./credentialCipher";

const key = Buffer.alloc(32, 7);

describe("credential encryption", () => {
  test("round-trips a secret", () => {
    const stored = encryptSecret("fixture-plaintext-value", key);
    expect(decryptSecret(stored, key)).toBe("fixture-plaintext-value");
  });

  test("the stored value never contains the plaintext", () => {
    const stored = encryptSecret("fixture-plaintext-value", key);
    expect(stored).not.toContain("fixture-plaintext");
    expect(stored.startsWith("enc:v1:")).toBe(true);
  });

  test("the same secret encrypts differently each time (fresh IV)", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  test("a tampered value is rejected, not decrypted to garbage", () => {
    const stored = encryptSecret("secret", key);
    const tampered =
      stored.slice(0, -2) + (stored.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  test("the wrong key is rejected", () => {
    const stored = encryptSecret("secret", key);
    expect(() => decryptSecret(stored, Buffer.alloc(32, 8))).toThrow();
  });

  // Keys saved before encryption existed must keep working until re-saved.
  test("a legacy plaintext value is returned as-is", () => {
    expect(decryptSecret("sk-ant-legacy", key)).toBe("sk-ant-legacy");
  });
});

describe("loadOrCreateKey", () => {
  test("creates a 32-byte key once and reuses it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aggcode-key-"));
    const file = path.join(dir, "nested", "credentials.key");
    const first = loadOrCreateKey(file);
    const second = loadOrCreateKey(file);
    expect(first.length).toBe(32);
    expect(second.equals(first)).toBe(true);
    expect(readFileSync(file, "utf8").trim().length).toBeGreaterThan(0);
    expect(statSync(file).isFile()).toBe(true);
  });

  test("an env key wins over the file", () => {
    const envKey = Buffer.alloc(32, 3).toString("base64");
    const dir = mkdtempSync(path.join(tmpdir(), "aggcode-key-"));
    expect(
      loadOrCreateKey(path.join(dir, "k"), envKey).equals(Buffer.alloc(32, 3)),
    ).toBe(true);
  });

  test("a malformed env key is refused", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aggcode-key-"));
    expect(() => loadOrCreateKey(path.join(dir, "k"), "too-short")).toThrow();
  });
});
