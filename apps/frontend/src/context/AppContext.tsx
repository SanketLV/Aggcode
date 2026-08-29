import type { MessagePart, OutgoingMessageType } from "commons/types";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from "react";
import { useSocket, type SocketStatus } from "../hooks/useSocket";
import { appendDelta, appendMessage } from "../lib/helpers";

export type UiWorkspace = {
  id: string;
  name: string;
  path: string;
  sessions: {
    id: string;
    messages: {
      role: "user" | "assistant";
      payload: { message: string; parts?: MessagePart[] };
    }[];
  }[];
  pending?: boolean;
};

type AppContextValue = {
  workspaces: UiWorkspace[];
  setWorkspaces: Dispatch<SetStateAction<UiWorkspace[]>>;
  socket: WebSocket | null;
  status: SocketStatus;
  loading: boolean;
  activeSessionId: string | null;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  openWorkspaceId: string | null;
  setOpenWorkspaceId: Dispatch<SetStateAction<string | null>>;
  workingSessionIds: string[];
  sessionErrors: Record<string, string>;
  liveTurns: Record<string, MessagePart[]>;
  runStartedAt: Record<string, number>;
  thinkingTokens: Record<string, number>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { loading, status, socket } = useSocket();
  const [workspaces, setWorkspaces] = useState<UiWorkspace[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);
  const [workingSessionIds, setWorkingSessionIds] = useState<string[]>([]);
  const [sessionErrors, setSessionErrors] = useState<Record<string, string>>(
    {},
  );
  const [liveTurns, setLiveTurns] = useState<Record<string, MessagePart[]>>({});
  const [runStartedAt, setRunStartedAt] = useState<Record<string, number>>({});
  const [thinkingTokens, setThinkingTokens] = useState<Record<string, number>>(
    {},
  );

  useEffect(() => {
    if (status !== "open") {
      setWorkingSessionIds([]);
    }
  }, [status]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    socket.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as OutgoingMessageType;

      if (data.type === "init") {
        setWorkspaces(data.workspaces as UiWorkspace[]);
      }

      if (data.type === "workspace-created") {
        const created = data.payload;
        setWorkspaces((current) => {
          const slot = current.findIndex(
            (w) => w.pending && w.path === created.path,
          );
          const settled: UiWorkspace = { ...created, sessions: [] };

          if (slot === -1) {
            return [...current, settled];
          }
          return current.map((w, i) => (i === slot ? settled : w));
        });
      }

      if (data.type === "session-created") {
        const { id, workspaceId } = data.payload;
        setWorkspaces((current) =>
          current.map((w) =>
            w.id === workspaceId
              ? { ...w, sessions: [...w.sessions, { id, messages: [] }] }
              : w,
          ),
        );
        setOpenWorkspaceId(workspaceId);
        setActiveSessionId(id);
      }

      if (data.type === "message-added") {
        const { sessionId, message } = data.payload;
        setWorkspaces((current) => appendMessage(current, sessionId, message));
      }

      if (data.type === "assistant-working") {
        const { sessionId } = data.payload;
        setWorkingSessionIds((current) =>
          current.includes(sessionId) ? current : [...current, sessionId],
        );
        setSessionErrors(({ [sessionId]: _clearedError, ...rest }) => rest);
        setLiveTurns(({ [sessionId]: _clearedTurn, ...rest }) => rest);
        setRunStartedAt((current) => ({ ...current, [sessionId]: Date.now() }));
        setThinkingTokens(({ [sessionId]: _clearedTokens, ...rest }) => rest);
      }

      if (data.type === "assistant-progress") {
        const { sessionId, thinkingTokens: tokens } = data.payload;
        setThinkingTokens((current) => ({ ...current, [sessionId]: tokens }));
      }

      if (data.type === "assistant-tool-result") {
        const { sessionId, toolId, status, output } = data.payload;
        setLiveTurns((current) => ({
          ...current,
          [sessionId]: (current[sessionId] ?? []).map((part) =>
            part.type === "tool" && part.toolId === toolId
              ? { ...part, status, output }
              : part,
          ),
        }));
      }

      if (data.type === "assistant-delta") {
        const { sessionId, text } = data.payload;
        setLiveTurns((current) => ({
          ...current,
          [sessionId]: appendDelta(current[sessionId] ?? [], text),
        }));
      }

      if (data.type === "assistant-tool") {
        const { sessionId, toolId, name, detail } = data.payload;
        setLiveTurns((current) => ({
          ...current,
          [sessionId]: [
            ...(current[sessionId] ?? []),
            { type: "tool", toolId, name, detail, status: "running" },
          ],
        }));
      }

      if (data.type === "assistant-message") {
        const { sessionId, message } = data.payload;
        setWorkspaces((current) => appendMessage(current, sessionId, message));
        setWorkingSessionIds((current) =>
          current.filter((id) => id !== sessionId),
        );
        setLiveTurns(({ [sessionId]: _replaced, ...rest }) => rest);
        setRunStartedAt(({ [sessionId]: _doneAt, ...rest }) => rest);
        setThinkingTokens(({ [sessionId]: _doneTokens, ...rest }) => rest);
      }

      if (data.type === "assistant-error") {
        const { sessionId, message } = data.payload;
        setWorkingSessionIds((current) =>
          current.filter((id) => id !== sessionId),
        );
        setSessionErrors((current) => ({ ...current, [sessionId]: message }));
        setRunStartedAt(({ [sessionId]: _failedAt, ...rest }) => rest);
        setThinkingTokens(({ [sessionId]: _failedTokens, ...rest }) => rest);
      }
    };

    return () => {
      socket.onmessage = null;
    };
  }, [socket]);

  return (
    <AppContext.Provider
      value={{
        workspaces,
        setWorkspaces,
        socket,
        status,
        loading,
        activeSessionId,
        setActiveSessionId,
        openWorkspaceId,
        setOpenWorkspaceId,
        workingSessionIds,
        sessionErrors,
        liveTurns,
        runStartedAt,
        thinkingTokens,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return ctx;
}
