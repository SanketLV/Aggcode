import { useEffect, useState } from "react";
import { loadSocketConfig } from "../lib/socketConfig";

export type SocketStatus = "connecting" | "open" | "closed";

export function useSocket() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>("connecting");

  useEffect(() => {
    let socket: WebSocket | undefined;
    // Guards against setting state after unmount, e.g. if the component
    // unmounts while loadSocketConfig's fetch is still in flight.
    let cancelled = false;

    loadSocketConfig()
      .then(({ wsUrl }) => {
        if (cancelled) {
          return;
        }

        socket = new WebSocket(wsUrl);

        // Exposed straight away so consumers can attach `onmessage` before
        // the handshake completes and the server pushes its `init` snapshot.
        setWs(socket);

        socket.onopen = () => setStatus("open");
        socket.onclose = () => setStatus("closed");
        socket.onerror = () => setStatus("closed");
      })
      .catch((err) => {
        console.error("Failed to load socket config:", err);
        if (!cancelled) {
          setStatus("closed");
        }
      });

    return () => {
      cancelled = true;
      if (socket) {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, []);

  return {
    socket: ws,
    status,
    loading: status === "connecting",
  };
}
