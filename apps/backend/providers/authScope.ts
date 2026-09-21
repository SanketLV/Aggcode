import type { ProviderAuthStatus, ProviderDescriptor } from "commons/types";
import type { AgentProvider } from "./types";

// Auth status checks shell out to CLIs and are requested several times per
// frame (catalog, descriptors, the add-message gate). Sharing one in-flight
// call keeps them from starving each other into timeouts, and the short cache
// keeps a page load from spawning a process per request.
export function memoizeAsync<T>(
  fn: () => Promise<T>,
  opts: {
    ttlMs: number;
    shouldCache?: (value: T) => boolean;
    now?: () => number;
  },
): { get(): Promise<T>; invalidate(): void } {
  const now = opts.now ?? Date.now;
  let cached: { value: T; at: number } | null = null;
  let inFlight: Promise<T> | null = null;

  return {
    get() {
      if (cached && now() - cached.at < opts.ttlMs) {
        return Promise.resolve(cached.value);
      }
      if (inFlight) {
        return inFlight;
      }
      const call = fn()
        .then((value) => {
          if (opts.shouldCache?.(value) ?? true) {
            cached = { value, at: now() };
          }
          return value;
        })
        .finally(() => {
          if (inFlight === call) {
            inFlight = null;
          }
        });
      inFlight = call;
      return call;
    },
    invalidate() {
      cached = null;
      inFlight = null;
    },
  };
}

// OpenCode keeps one machine-wide credential store shared with the `opencode`
// CLI, so Aggcode only ever removes providers it connected itself.
export function planOpenCodeLogout(
  appConnected: string[],
  target?: string,
): { remove: string[]; notOwned: string[] } {
  if (target === undefined) {
    return { remove: [...appConnected], notOwned: [] };
  }
  const id = target.toLowerCase();
  return appConnected.includes(id)
    ? { remove: [id], notOwned: [] }
    : { remove: [], notOwned: [id] };
}

// The id becomes both a Mongo map key and a URL path segment.
export function isValidSubProviderId(id: string): boolean {
  return /^[a-z0-9_-]+$/i.test(id);
}

type AuthCapable = Pick<AgentProvider, "id" | "name" | "auth">;

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

// Fails closed: if the sign-in cannot be confirmed, the run does not start.
export async function chatGateRejection(
  provider: AuthCapable,
): Promise<string | null> {
  if (!provider.auth) {
    return null;
  }
  let status: ProviderAuthStatus;
  try {
    status = await provider.auth.getAuthStatus();
  } catch (err) {
    console.warn(`[chat gate] ${provider.id} status check failed:`, err);
    return `Could not check the sign-in for ${provider.name}: ${errorText(err)}. Try again, or reconnect it in provider settings.`;
  }
  if (!status.isAuthenticated) {
    return `Not signed in to ${provider.name}. Connect it in provider settings to enable chat.`;
  }
  return null;
}

// The modal needs both the status map and the per-provider descriptors, and
// building them separately ran every CLI and server check twice, in sequence.
export async function buildAuthSnapshot(providers: AuthCapable[]): Promise<{
  statuses: Record<string, ProviderAuthStatus>;
  descriptors: ProviderDescriptor[];
}> {
  const entries = await Promise.all(
    providers.map(async (p): Promise<ProviderDescriptor> => {
      if (!p.auth) {
        return {
          id: p.id,
          name: p.name,
          authMethods: [],
          status: {
            providerId: p.id,
            isAuthenticated: true,
            details: "No authentication required",
          },
        };
      }
      let status: ProviderAuthStatus;
      try {
        status = await p.auth.getAuthStatus();
      } catch (err) {
        console.warn(`[auth snapshot] ${p.id} status check failed:`, err);
        status = {
          providerId: p.id,
          isAuthenticated: false,
          details: `Status check failed: ${errorText(err)}`,
        };
      }
      return {
        id: p.id,
        name: p.name,
        authMethods: p.auth.getAuthMethods(),
        status,
      };
    }),
  );
  return {
    statuses: Object.fromEntries(entries.map((d) => [d.id, d.status])),
    descriptors: entries,
  };
}
