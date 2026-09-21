import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";

// API keys are stored encrypted so a copy of the database (a dump, a backup,
// a shared Mongo instance) does not hand out working credentials. The key lives
// outside the database: AGGCODE_CREDENTIALS_KEY if set, else a file created on
// first use in the user's home directory.
const PREFIX = "enc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export const DEFAULT_KEY_PATH = path.join(
  homedir(),
  ".aggcode",
  "credentials.key",
);

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${body.toString("base64")}`;
}

// Values without the prefix predate encryption and are returned unchanged, so
// a key saved by an older build keeps working until it is saved again.
export function decryptSecret(stored: string, key: Buffer): string {
  if (!stored.startsWith(PREFIX)) {
    return stored;
  }
  const [ivB64, tagB64, bodyB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || bodyB64 === undefined) {
    throw new Error("Stored credential is malformed.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(bodyB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function loadOrCreateKey(
  keyPath: string = DEFAULT_KEY_PATH,
  envKey: string | undefined = process.env.AGGCODE_CREDENTIALS_KEY,
): Buffer {
  if (envKey) {
    const key = Buffer.from(envKey, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `AGGCODE_CREDENTIALS_KEY must be ${KEY_BYTES} bytes, base64-encoded.`,
      );
    }
    return key;
  }
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(`Credential key file ${keyPath} is corrupt.`);
    }
    return key;
  }
  const key = randomBytes(KEY_BYTES);
  mkdirSync(path.dirname(keyPath), { recursive: true });
  // `wx` refuses to overwrite a key another process created meanwhile.
  writeFileSync(keyPath, key.toString("base64"), { mode: 0o600, flag: "wx" });
  return key;
}
