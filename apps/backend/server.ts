import { WebSocketServer, type WebSocket } from "ws";

export type ServerStartErrorKind = "in-use" | "denied" | "other";

export class ServerStartError extends Error {
  readonly kind: ServerStartErrorKind;

  constructor(kind: ServerStartErrorKind, message: string) {
    super(message);
    this.name = "ServerStartError";
    this.kind = kind;
  }
}

export type StartServerOptions = {
  host: string;
  port: number;
  onConnection?: (ws: WebSocket) => void;
};

export type RunningServer = {
  port: number;
  close: () => Promise<void>;
};

/**
 * Binds a WebSocketServer and resolves once it is actually listening, so the
 * caller (Electron, or index.ts) learns the real port when `port: 0` asks
 * the OS to pick one. Rejects with a typed ServerStartError instead of the
 * unhandled 'error' event ws emits by default.
 *
 * `createServer` is injectable so tests can grab a reference to the
 * WebSocketServer and emit a runtime error on it directly.
 */
export function startServer(
  { host, port, onConnection }: StartServerOptions,
  createServer: (opts: { host: string; port: number }) => WebSocketServer = (
    opts,
  ) => new WebSocketServer(opts),
): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const wss = createServer({ host, port });
    let started = false;

    // One listener for the server's whole lifetime: `ws` forwards the
    // underlying socket's 'error' events for as long as the server exists,
    // not just while binding. Removing this after `listening` (as an
    // earlier version did) leaves later errors (e.g. EMFILE) with no
    // listener, which throws synchronously and kills the whole process.
    wss.on("error", (err: NodeJS.ErrnoException) => {
      if (started) {
        console.error("WebSocket server error:", err);
        return;
      }

      if (err.code === "EADDRINUSE") {
        reject(
          new ServerStartError(
            "in-use",
            `Port ${port} is already in use. Set AGGCODE_PORT to another port.`,
          ),
        );
      } else if (err.code === "EACCES") {
        reject(
          new ServerStartError(
            "denied",
            `Permission denied binding to ${host}:${port}.`,
          ),
        );
      } else {
        reject(new ServerStartError("other", err.message));
      }
    });

    wss.once("listening", () => {
      started = true;

      const address = wss.address();
      const realPort =
        typeof address === "object" && address !== null ? address.port : port;

      if (onConnection) {
        wss.on("connection", onConnection);
      }

      resolve({
        port: realPort,
        close: () =>
          new Promise<void>((res, rej) => {
            wss.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
