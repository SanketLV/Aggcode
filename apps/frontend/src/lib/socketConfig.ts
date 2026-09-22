export type SocketConfig = {
  wsUrl: string;
};

declare global {
  interface Window {
    /** Set by the Electron preload script; skips the /api/config fetch. */
    __AGGCODE_CONFIG__?: SocketConfig;
  }
}

export function parseSocketConfig(value: unknown): SocketConfig {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { wsUrl?: unknown }).wsUrl !== "string"
  ) {
    throw new Error("Invalid socket config: expected { wsUrl: string }");
  }
  return { wsUrl: (value as { wsUrl: string }).wsUrl };
}

type FetchLike = (input: string) => Promise<Response>;

type LoadSocketConfigOptions = {
  /** Injectable for tests; defaults to window.__AGGCODE_CONFIG__. */
  windowConfig?: SocketConfig;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: FetchLike;
};

/**
 * Resolves the backend's WebSocket URL. The Electron shell sets
 * window.__AGGCODE_CONFIG__ through its preload script, which skips the
 * network round trip entirely; the dev/browser path fetches it from the
 * frontend server's own /api/config route.
 */
export async function loadSocketConfig(
  options: LoadSocketConfigOptions = {},
): Promise<SocketConfig> {
  const windowConfig =
    options.windowConfig ??
    (typeof window !== "undefined" ? window.__AGGCODE_CONFIG__ : undefined);

  if (windowConfig) {
    return parseSocketConfig(windowConfig);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("/api/config");

  if (!response.ok) {
    throw new Error(`/api/config returned ${response.status}`);
  }

  const body = await response.json();
  return parseSocketConfig(body);
}
