import type {
  IncomingMessageType,
  MessagePart,
  OutgoingMessageType,
  ProviderAuthStatus,
  ProviderDescriptor,
  ProviderOption,
} from "commons/types";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSocket, type SocketStatus } from "../hooks/useSocket";
import { appendDelta, appendMessage, send } from "../lib/helpers";

// Long enough for OpenCode's server to cold-start on a first connect.
const AUTH_ACTION_TIMEOUT_MS = 30_000;

export type UiWorkspace = {
  id: string;
  name: string;
  path: string;
  sessions: {
    id: string;
    provider?: string;
    model?: string;
    effort?: string;
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
  providers: ProviderOption[];
  providerAuth: Record<string, ProviderAuthStatus>;
  providerDescriptors: ProviderDescriptor[];
  authModalOpen: boolean;
  setAuthModalOpen: Dispatch<SetStateAction<boolean>>;
  authModalProviderId: string | null;
  setAuthModalProviderId: Dispatch<SetStateAction<string | null>>;
  authActionState: {
    loading: boolean;
    providerId?: string;
    action?: string;
    message?: string;
    error?: string;
  };
  loginProvider: (
    providerId: string,
    method: string,
    credentials?: Record<string, string>,
  ) => void;
  logoutProvider: (providerId: string, target?: string) => void;
  refreshProviderAuth: () => void;
  updateSessionConfig: (
    sessionId: string,
    config: { provider: string; model?: string; effort?: string },
  ) => void;
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
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerAuth, setProviderAuth] = useState<
    Record<string, ProviderAuthStatus>
  >({});
  const [providerDescriptors, setProviderDescriptors] = useState<
    ProviderDescriptor[]
  >([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalProviderId, setAuthModalProviderId] = useState<string | null>(
    null,
  );
  const [authActionState, setAuthActionState] = useState<{
    loading: boolean;
    providerId?: string;
    action?: string;
    message?: string;
    error?: string;
  }>({ loading: false });
  // The spinner clears only on provider-auth-result, so a request that never
  // left (socket closed) or never got answered must clear it here instead.
  const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        if (data.providers) {
          setProviders(data.providers);
        }
        if (data.providerAuth) {
          setProviderAuth(data.providerAuth);
        }
        if (data.providerDescriptors) {
          setProviderDescriptors(data.providerDescriptors);
        }
      }

      if (data.type === "provider-auth-updated") {
        setProviderAuth(data.payload.statuses);
        if (data.payload.descriptors) {
          setProviderDescriptors(data.payload.descriptors);
        }
      }

      if (data.type === "provider-catalog-updated") {
        setProviders(data.payload.providers);
      }

      if (data.type === "provider-auth-result") {
        if (authTimeoutRef.current) {
          clearTimeout(authTimeoutRef.current);
          authTimeoutRef.current = null;
        }
        setAuthActionState({
          loading: false,
          providerId: data.payload.providerId,
          action: data.payload.action,
          message: data.payload.success ? data.payload.message : undefined,
          error: !data.payload.success ? data.payload.message : undefined,
        });
      }

      if (data.type === "session-config-updated") {
        const { sessionId, provider, model, effort } = data.payload;
        setWorkspaces((current) =>
          current.map((w) => ({
            ...w,
            sessions: w.sessions.map((s) =>
              s.id === sessionId ? { ...s, provider, model, effort } : s,
            ),
          })),
        );
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

      if (data.type === "workspace-deleted") {
        const { workspaceId } = data.payload;
        setWorkspaces((current) => current.filter((w) => w.id !== workspaceId));
        if (openWorkspaceId === workspaceId) {
          setOpenWorkspaceId(null);
        }
        // Clear active session if it belonged to the deleted workspace
        setWorkspaces((current) => {
          const deletedWorkspace = workspaces.find((w) => w.id === workspaceId);
          if (
            deletedWorkspace?.sessions.some((s) => s.id === activeSessionId)
          ) {
            setActiveSessionId(null);
          }
          return current;
        });
      }

      if (data.type === "session-deleted") {
        const { sessionId } = data.payload;
        setWorkspaces((current) =>
          current.map((w) => ({
            ...w,
            sessions: w.sessions.filter((s) => s.id !== sessionId),
          })),
        );
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
        }
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

  const updateSessionConfig = (
    sessionId: string,
    config: { provider: string; model?: string; effort?: string },
  ) => {
    setWorkspaces((current) =>
      current.map((w) => ({
        ...w,
        sessions: w.sessions.map((s) =>
          s.id === sessionId ? { ...s, ...config } : s,
        ),
      })),
    );
    send(socket, {
      type: "update-session-config",
      payload: {
        sessionId,
        provider: config.provider,
        model: config.model,
        effort: config.effort as any,
      },
    });
  };

  const startAuthAction = (
    providerId: string,
    action: "login" | "logout",
    message: IncomingMessageType,
  ) => {
    if (authTimeoutRef.current) {
      clearTimeout(authTimeoutRef.current);
    }
    if (!send(socket, message)) {
      setAuthActionState({
        loading: false,
        providerId,
        action,
        error: "Not connected to the server. Reload the page and try again.",
      });
      return;
    }
    setAuthActionState({ loading: true, providerId, action });
    authTimeoutRef.current = setTimeout(() => {
      setAuthActionState({
        loading: false,
        providerId,
        action,
        error: "The server did not answer. Check the backend and try again.",
      });
    }, AUTH_ACTION_TIMEOUT_MS);
  };

  const loginProvider = (
    providerId: string,
    method: string,
    credentials?: Record<string, string>,
  ) => {
    startAuthAction(providerId, "login", {
      type: "provider-login",
      payload: { providerId, method, credentials },
    });
  };

  const logoutProvider = (providerId: string, target?: string) => {
    startAuthAction(providerId, "logout", {
      type: "provider-logout",
      payload: { providerId, target },
    });
  };

  const refreshProviderAuth = () => {
    send(socket, {
      type: "get-provider-auth",
      payload: {},
    });
  };

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
        providers,
        providerAuth,
        providerDescriptors,
        authModalOpen,
        setAuthModalOpen,
        authModalProviderId,
        setAuthModalProviderId,
        authActionState,
        loginProvider,
        logoutProvider,
        refreshProviderAuth,
        updateSessionConfig,
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
