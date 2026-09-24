import { parsePort } from "commons/config";

export type SocketServerConfig = {
  wsUrl: string;
};

const DEFAULT_BACKEND_PORT = 3000;
export const DEFAULT_WEB_PORT = 3001;

/**
 * Builds the config the browser fetches from /api/config. AGGCODE_BACKEND_URL
 * is an escape hatch for anything the port-based default can't express (a
 * remote backend, a non-default host); when set, it wins outright.
 */
export function buildSocketConfig(
  env: Record<string, string | undefined>,
): SocketServerConfig {
  if (env.AGGCODE_BACKEND_URL) {
    if (!/^wss?:\/\//.test(env.AGGCODE_BACKEND_URL)) {
      throw new Error(
        `AGGCODE_BACKEND_URL must start with ws:// or wss://, got "${env.AGGCODE_BACKEND_URL}"`,
      );
    }
    return { wsUrl: env.AGGCODE_BACKEND_URL };
  }

  if (env.AGGCODE_PORT === "0") {
    throw new Error(
      "AGGCODE_PORT=0 has no meaning on the frontend server: it can't know " +
        "which port the backend's OS-assigned port ended up being. Set " +
        "AGGCODE_BACKEND_URL to the backend's actual address instead.",
    );
  }

  const port = parsePort(
    env.AGGCODE_PORT,
    "AGGCODE_PORT",
    DEFAULT_BACKEND_PORT,
  );
  return { wsUrl: `ws://127.0.0.1:${port}` };
}

/** AGGCODE_WEB_PORT: which port this frontend server itself listens on. */
export function resolveWebPort(
  env: Record<string, string | undefined>,
): number {
  return parsePort(env.AGGCODE_WEB_PORT, "AGGCODE_WEB_PORT", DEFAULT_WEB_PORT);
}
