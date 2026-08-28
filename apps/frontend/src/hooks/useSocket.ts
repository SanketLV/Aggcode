import { useEffect, useState } from "react";

const SOCKET_URL = "ws://localhost:3000";

export type SocketStatus = "connecting" | "open" | "closed";

export function useSocket() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<SocketStatus>("connecting");

  useEffect(() => {
    const socket = new WebSocket(SOCKET_URL);

    // Exposed straight away so consumers can attach `onmessage` before the
    // handshake completes and the server pushes its `init` snapshot.
    setWs(socket);

    socket.onopen = () => setStatus("open");
    socket.onclose = () => setStatus("closed");
    socket.onerror = () => setStatus("closed");

    return () => {
      socket.onopen = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    };
  }, []);

  return {
    socket: ws,
    status,
    loading: status === "connecting",
  };
}
