/**
 * Parses a port number from an env var string. Empty/undefined means "use
 * the default"; anything else must be an integer in the valid port range.
 * Shared by the backend and the frontend server, which both need the same
 * "0 means let the OS pick" rule.
 */
export function parsePort(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer, got "${value}"`);
  }

  const port = Number(value);
  if (port > 65535) {
    throw new Error(`${name} must be between 0 and 65535, got "${value}"`);
  }

  return port;
}
