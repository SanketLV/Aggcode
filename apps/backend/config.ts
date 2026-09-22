import { parsePort } from "commons/config";

export type ServerConfig = {
  host: string;
  port: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

export function resolveServerConfig(
  env: Record<string, string | undefined>,
): ServerConfig {
  return {
    host: env.AGGCODE_HOST || DEFAULT_HOST,
    port: parsePort(env.AGGCODE_PORT, "AGGCODE_PORT", DEFAULT_PORT),
  };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

// Used to decide whether to warn that the agent is reachable from other
// machines. Not a full loopback-CIDR check, just the values people actually
// set AGGCODE_HOST to.
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}
