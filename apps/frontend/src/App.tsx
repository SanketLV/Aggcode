import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronRight, MessageSquare, Plus } from "lucide-react";
import { AppContext, type UiWorkspace } from "./context/AppContext";
import { useSocket } from "./hooks/useSocket";
import "./index.css";
import type { IncomingMessageType, OutgoingMessageType } from "commons/types";

// Shape rules for this app: interactive controls are `rounded-md`, panels and
// message bubbles are `rounded-lg`. Icons are lucide at strokeWidth 1.5.
const ICON_STROKE = 1.5;

function send(socket: WebSocket | null, message: IncomingMessageType): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}

export function App() {
  const { loading, status, socket } = useSocket();
  const [workspaces, setWorkspaces] = useState<UiWorkspace[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) {
      return;
    }

    socket.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as OutgoingMessageType;

      if (data.type === "init") {
        setWorkspaces(data.workspaces);
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
        setWorkspaces((current) =>
          current.map((w) => ({
            ...w,
            sessions: w.sessions.map((s) =>
              s.id === sessionId
                ? { ...s, messages: [...s.messages, message] }
                : s,
            ),
          })),
        );
      }
    };

    return () => {
      socket.onmessage = null;
    };
  }, [socket]);

  if (loading) {
    return <ConnectingShell />;
  }

  return (
    <AppContext.Provider
      value={{
        workspaces,
        setWorkspaces,
        socket,
        status,
        activeSessionId,
        setActiveSessionId,
        openWorkspaceId,
        setOpenWorkspaceId,
      }}
    >
      <div className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
        <Sidebar />
        <ChatPane />
      </div>
    </AppContext.Provider>
  );
}

function ConnectingShell() {
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
      <div className="w-72 shrink-0 border-r border-border bg-card p-4">
        <div className="h-4 w-20 rounded-md bg-muted" />
        <div className="mt-6 space-y-2">
          <div className="h-9 rounded-md bg-muted" />
          <div className="h-9 w-4/5 rounded-md bg-muted" />
          <div className="h-9 w-3/5 rounded-md bg-muted" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Connecting to the server</p>
      </div>
    </div>
  );
}

function Sidebar() {
  const {
    socket,
    status,
    workspaces,
    setWorkspaces,
    activeSessionId,
    setActiveSessionId,
    openWorkspaceId,
    setOpenWorkspaceId,
  } = useContext(AppContext);
  const [path, setPath] = useState("");

  const online = status === "open";

  const addWorkspace = () => {
    const trimmed = path.trim();
    if (trimmed === "" || !online) {
      return;
    }

    const sent = send(socket, {
      type: "create-workspace",
      payload: { path: trimmed },
    });

    if (!sent) {
      return;
    }

    setWorkspaces((current) => [
      ...current,
      {
        id: `pending:${crypto.randomUUID()}`,
        name: trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed,
        path: trimmed,
        sessions: [],
        pending: true,
      },
    ]);
    setPath("");
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight">Aggcode</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {online ? "Connected" : "Connection lost. Reload to reconnect."}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {workspaces.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No workspaces yet. Add a folder path below to start.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {workspaces.map((workspace) => {
              const isOpen = openWorkspaceId === workspace.id;

              if (workspace.pending) {
                return (
                  <li
                    key={workspace.id}
                    className="flex items-center gap-2 rounded-md px-2 py-2 opacity-60"
                  >
                    <ChevronRight
                      strokeWidth={ICON_STROKE}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {workspace.name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        Creating
                      </span>
                    </span>
                  </li>
                );
              }

              return (
                <li key={workspace.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenWorkspaceId(isOpen ? null : workspace.id)
                    }
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                  >
                    <ChevronRight
                      strokeWidth={ICON_STROKE}
                      className={`size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
                        isOpen ? "rotate-90" : ""
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {workspace.name}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {workspace.path}
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="mt-0.5 mb-1 ml-4 border-l border-border pl-2">
                      {workspace.sessions.length === 0 ? (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">
                          No sessions in this workspace yet.
                        </p>
                      ) : (
                        <ul>
                          {workspace.sessions.map((session, index) => {
                            const isActive = session.id === activeSessionId;
                            const label =
                              session.messages[0]?.payload.message ??
                              `Session ${index + 1}`;

                            return (
                              <li key={session.id}>
                                <button
                                  type="button"
                                  onClick={() => setActiveSessionId(session.id)}
                                  className={`w-full truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none ${
                                    isActive
                                      ? "bg-accent text-accent-foreground"
                                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                  }`}
                                >
                                  {label}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      <button
                        type="button"
                        disabled={!online}
                        onClick={() =>
                          send(socket, {
                            type: "create-session",
                            payload: { workspaceId: workspace.id },
                          })
                        }
                        className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent motion-reduce:transition-none"
                      >
                        <Plus strokeWidth={ICON_STROKE} className="size-3.5" />
                        New session
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          addWorkspace();
        }}
      >
        <label
          htmlFor="workspace-path"
          className="block text-xs font-medium text-muted-foreground"
        >
          Workspace path
        </label>
        <div className="mt-1.5 flex gap-1.5">
          <input
            id="workspace-path"
            type="text"
            value={path}
            spellCheck={false}
            placeholder={"D:\\Projects\\my-app"}
            onChange={(e) => setPath(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={!online || path.trim() === ""}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-[1px] disabled:opacity-50 motion-reduce:transition-none"
          >
            Add
          </button>
        </div>
      </form>
    </aside>
  );
}

function ChatPane() {
  const { socket, status, workspaces, activeSessionId } =
    useContext(AppContext);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const online = status === "open";

  const active = useMemo(() => {
    for (const workspace of workspaces) {
      const session = workspace.sessions.find((s) => s.id === activeSessionId);
      if (session) {
        return { workspace, session };
      }
    }
    return null;
  }, [workspaces, activeSessionId]);

  const messageCount = active?.session.messages.length ?? 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messageCount, activeSessionId]);

  if (!active) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <MessageSquare
            strokeWidth={ICON_STROKE}
            className="mx-auto size-6 text-muted-foreground"
          />
          <h2 className="mt-3 text-sm font-medium">No session open</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a workspace on the left, then pick one of its sessions or create
            a new one.
          </p>
        </div>
      </main>
    );
  }

  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed === "" || !online) {
      return;
    }

    const sent = send(socket, {
      type: "add-message",
      payload: { sessionId: active.session.id, message: trimmed },
    });

    if (sent) {
      setDraft("");
    }
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-baseline gap-2 border-b border-border px-5 py-3">
        <span className="truncate text-sm font-medium">
          {active.workspace.name}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {active.workspace.path}
        </span>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {active.session.messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Nothing in this session yet. Send the first message.
          </p>
        ) : (
          <ol className="mx-auto flex max-w-2xl flex-col gap-3">
            {active.session.messages.map((message, index) => (
              <li
                key={index}
                className={
                  message.role === "user" ? "flex justify-end" : "flex justify-start"
                }
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <p className="break-words whitespace-pre-wrap">
                    {message.payload.message}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <form
        className="shrink-0 border-t border-border px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <label htmlFor="composer" className="sr-only">
            Message
          </label>
          <textarea
            id="composer"
            rows={1}
            value={draft}
            placeholder="Send a message"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="max-h-32 min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none field-sizing-content"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={!online || draft.trim() === ""}
            className="rounded-md bg-primary p-2 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-[1px] disabled:opacity-50 motion-reduce:transition-none"
          >
            <ArrowUp strokeWidth={ICON_STROKE} className="size-4" />
          </button>
        </div>
        {!online && (
          <p className="mx-auto mt-2 max-w-2xl text-xs text-muted-foreground">
            Disconnected from the server, so messages cannot be saved.
          </p>
        )}
      </form>
    </main>
  );
}

export default App;
