import { createOpencodeServer } from "@opencode-ai/sdk/server";

let activeServer: { url: string; close(): void } | null = null;
let startingPromise: Promise<string> | null = null;

async function isServerRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/session`, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    });
    // Any HTTP response means an OpenCode server is listening
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function ensureOpenCodeServer(): Promise<string> {
  // If we already started an embedded server and it's active
  if (activeServer) {
    return activeServer.url;
  }

  // If startup is already in progress, await the same promise
  if (startingPromise) {
    return startingPromise;
  }

  startingPromise = (async () => {
    const defaultPort = Number(process.env.OPENCODE_PORT) || 4096;
    const defaultUrl = `http://127.0.0.1:${defaultPort}`;

    // 1. Check if an OpenCode server is already running externally
    if (await isServerRunning(defaultUrl)) {
      console.log(`[opencode] Attached to existing server at ${defaultUrl}`);
      return defaultUrl;
    }

    // 2. Start an embedded server
    console.log(
      `[opencode] Starting OpenCode server on port ${defaultPort}...`,
    );
    try {
      const server = await createOpencodeServer({
        hostname: "127.0.0.1",
        port: defaultPort,
        timeout: 15000,
      });

      activeServer = server;
      console.log(`[opencode] Server started successfully at ${server.url}`);
      return server.url;
    } catch (err) {
      // If default port was busy, try fallback port
      const fallbackPort = defaultPort + 1;
      console.warn(
        `[opencode] Failed on port ${defaultPort}, trying port ${fallbackPort}...`,
        err,
      );
      const server = await createOpencodeServer({
        hostname: "127.0.0.1",
        port: fallbackPort,
        timeout: 15000,
      });
      activeServer = server;
      console.log(`[opencode] Server started at ${server.url}`);
      return server.url;
    }
  })().finally(() => {
    startingPromise = null;
  });

  return startingPromise;
}

export function shutdownOpenCodeServer(): void {
  if (activeServer) {
    console.log("[opencode] Shutting down OpenCode server...");
    try {
      activeServer.close();
    } catch (e) {
      console.error("[opencode] Error closing server:", e);
    }
    activeServer = null;
  }
}

// Ensure clean exit
process.on("SIGINT", shutdownOpenCodeServer);
process.on("SIGTERM", shutdownOpenCodeServer);
process.on("exit", shutdownOpenCodeServer);
