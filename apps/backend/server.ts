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
 */
export function startServer({
  host,
  port,
  onConnection,
}: StartServerOptions): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host, port });

    const onError = (err: NodeJS.ErrnoException) => {
      wss.removeAllListeners();
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
    };

    wss.once("error", onError);

    wss.once("listening", () => {
      wss.removeListener("error", onError);

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
