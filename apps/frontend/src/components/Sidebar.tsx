import { useState } from "react";
import { ChevronRight, FolderPlus, Plus, Trash2 } from "lucide-react";
import { ICON_STROKE } from "../constants";
import { useApp } from "../context/AppContext";
import { send } from "../lib/helpers";
import { ConfirmModal } from "./ConfirmModal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";

type DeleteTarget = {
  type: "workspace" | "session";
  id: string;
  name: string;
  sessionCount: number;
};

// Revealed on row hover or keyboard focus, so delete is findable without
// knowing about the context menu, and doesn't clutter every row at rest.
function RowDeleteButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="focus-ring absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground opacity-0 transition-colors group-hover:opacity-100 hover:bg-destructive/12 hover:text-destructive focus-visible:opacity-100 motion-reduce:transition-none"
    >
      <Trash2 strokeWidth={ICON_STROKE} className="size-3.5" />
    </button>
  );
}

export function Sidebar() {
  const {
    socket,
    status,
    workspaces,
    setWorkspaces,
    activeSessionId,
    setActiveSessionId,
    openWorkspaceId,
    setOpenWorkspaceId,
    providers,
    providerAuth,
    setAuthModalOpen,
    setAuthModalProviderId,
  } = useApp();
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  // The target outlives the open flag so the dialog keeps its text while it
  // animates closed, instead of flipping to the session wording mid-fade.
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const askDelete = (target: DeleteTarget) => {
    setDeleteTarget(target);
    setDeleteOpen(true);
  };

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
    setAdding(false);
  };

  const cancelAdding = () => {
    setPath("");
    setAdding(false);
  };

  const handleDelete = () => {
    if (!deleteTarget || !online) return;

    if (deleteTarget.type === "workspace") {
      send(socket, {
        type: "delete-workspace",
        payload: { workspaceId: deleteTarget.id },
      });
    } else {
      send(socket, {
        type: "delete-session",
        payload: { sessionId: deleteTarget.id },
      });
    }

    setDeleteOpen(false);
  };

  const openProvider = (providerId: string) => {
    setAuthModalProviderId(providerId);
    setAuthModalOpen(true);
  };

  const deleteMessage = (() => {
    if (!deleteTarget) return "";
    if (deleteTarget.type === "session") {
      return `Delete "${deleteTarget.name}"? Its messages are removed too. This can't be undone.`;
    }
    const n = deleteTarget.sessionCount;
    const sessions =
      n === 0 ? "" : ` and its ${n} ${n === 1 ? "session" : "sessions"}`;
    return `Delete ${deleteTarget.name}${sessions}? The folder on disk is not touched. This can't be undone.`;
  })();

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-x-hidden border-r border-border bg-card">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border pr-2.5 pl-3.5">
        <div
          aria-hidden="true"
          className="flex size-6.5 items-center justify-center rounded-md border border-border-strong bg-muted font-mono text-micro font-medium text-primary"
        >
          &gt;_
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-ui font-semibold tracking-tight">Aggcode</h1>
          <p
            role="status"
            className="flex items-center gap-1.5 text-micro text-subtle-foreground"
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${online ? "bg-success" : "bg-warning"}`}
            />
            {online ? "Connected" : "Disconnected. Reload to reconnect."}
          </p>
        </div>
        <button
          type="button"
          aria-label="Add workspace"
          aria-expanded={adding}
          disabled={!online}
          onClick={() => setAdding((v) => !v)}
          className="focus-ring flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 motion-reduce:transition-none"
        >
          <Plus strokeWidth={ICON_STROKE} className="size-4" />
        </button>
      </div>

      {adding && (
        <form
          className="border-b border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            addWorkspace();
          }}
        >
          <label
            htmlFor="workspace-path"
            className="block text-xs font-medium text-muted-foreground"
          >
            Folder path
          </label>
          <input
            id="workspace-path"
            type="text"
            autoFocus
            value={path}
            spellCheck={false}
            placeholder={"D:\\Projects\\my-app"}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelAdding();
            }}
            className="focus-ring mt-1.5 h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-micro text-foreground placeholder:text-subtle-foreground"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={cancelAdding}
              className="focus-ring h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground motion-reduce:transition-none"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!online || path.trim() === ""}
              className="focus-ring h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:translate-y-px disabled:opacity-40 motion-reduce:transition-none"
            >
              Add workspace
            </button>
          </div>
        </form>
      )}

      <div className="flex items-center justify-between pt-4 pr-3.5 pb-1.5 pl-4 text-micro font-medium text-subtle-foreground">
        <span>Workspaces</span>
        {workspaces.length > 0 && (
          <span className="tabular-nums">{workspaces.length}</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <FolderPlus
              strokeWidth={ICON_STROKE}
              aria-hidden="true"
              className="size-5 text-subtle-foreground"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              No workspaces yet. Add the folder of a project to start.
            </p>
            {!adding && (
              <button
                type="button"
                disabled={!online}
                onClick={() => setAdding(true)}
                className="focus-ring mt-3 h-7 rounded-md bg-muted px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50 motion-reduce:transition-none"
              >
                Add workspace
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {workspaces.map((workspace) => {
              const isOpen = openWorkspaceId === workspace.id;

              if (workspace.pending) {
                return (
                  <li
                    key={workspace.id}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 opacity-60"
                  >
                    <ChevronRight
                      strokeWidth={ICON_STROKE}
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui font-medium">
                        {workspace.name}
                      </span>
                      <span className="block text-micro text-muted-foreground">
                        Adding…
                      </span>
                    </span>
                  </li>
                );
              }

              return (
                <li key={workspace.id} className="min-w-0">
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div className="group relative min-w-0">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setOpenWorkspaceId(isOpen ? null : workspace.id)
                          }
                          className="focus-ring flex w-full min-w-0 items-start gap-2 rounded-md py-1.5 pr-8 pl-2 text-left transition-colors hover:bg-accent/60 motion-reduce:transition-none"
                        >
                          <ChevronRight
                            strokeWidth={ICON_STROKE}
                            aria-hidden="true"
                            className={`mt-0.5 size-3.5 shrink-0 text-subtle-foreground transition-transform motion-reduce:transition-none ${
                              isOpen ? "rotate-90" : ""
                            }`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-ui font-medium">
                              {workspace.name}
                            </span>
                            <span
                              title={workspace.path}
                              className="block truncate font-mono text-micro text-muted-foreground"
                            >
                              {workspace.path}
                            </span>
                          </span>
                        </button>
                        <RowDeleteButton
                          label={`Delete workspace ${workspace.name}`}
                          onClick={() =>
                            askDelete({
                              type: "workspace",
                              id: workspace.id,
                              name: workspace.name,
                              sessionCount: workspace.sessions.length,
                            })
                          }
                        />
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                        onSelect={() =>
                          askDelete({
                            type: "workspace",
                            id: workspace.id,
                            name: workspace.name,
                            sessionCount: workspace.sessions.length,
                          })
                        }
                      >
                        <Trash2
                          strokeWidth={ICON_STROKE}
                          className="size-3.5"
                        />
                        Delete workspace
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>

                  {isOpen && (
                    <div className="mt-0.5 mb-1.5 ml-[15px] border-l border-border-strong/70 pl-2">
                      {workspace.sessions.length === 0 ? (
                        <p className="px-2.5 py-1.5 text-xs text-subtle-foreground">
                          No sessions yet.
                        </p>
                      ) : (
                        <ul className="space-y-px">
                          {workspace.sessions.map((session, index) => {
                            const isActive = session.id === activeSessionId;
                            const label =
                              session.messages[0]?.payload.message ??
                              `Session ${index + 1}`;

                            return (
                              <li key={session.id} className="min-w-0">
                                <ContextMenu>
                                  <ContextMenuTrigger asChild>
                                    <div className="group relative min-w-0">
                                      {isActive && (
                                        <span
                                          aria-hidden="true"
                                          className="absolute top-[7px] bottom-[7px] -left-[9px] w-0.5 rounded-sm bg-primary"
                                        />
                                      )}
                                      <button
                                        type="button"
                                        aria-current={
                                          isActive ? "true" : undefined
                                        }
                                        onClick={() =>
                                          setActiveSessionId(session.id)
                                        }
                                        className={`focus-ring block h-8 w-full min-w-0 truncate rounded-md pr-8 pl-2.5 text-left text-ui transition-colors motion-reduce:transition-none ${
                                          isActive
                                            ? "bg-accent text-foreground"
                                            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                                        }`}
                                      >
                                        {label}
                                      </button>
                                      <RowDeleteButton
                                        label={`Delete session ${label}`}
                                        onClick={() =>
                                          askDelete({
                                            type: "session",
                                            id: session.id,
                                            name: label,
                                            sessionCount: 0,
                                          })
                                        }
                                      />
                                    </div>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent>
                                    <ContextMenuItem
                                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                      onSelect={() =>
                                        askDelete({
                                          type: "session",
                                          id: session.id,
                                          name: label,
                                          sessionCount: 0,
                                        })
                                      }
                                    >
                                      <Trash2
                                        strokeWidth={ICON_STROKE}
                                        className="size-3.5"
                                      />
                                      Delete session
                                    </ContextMenuItem>
                                  </ContextMenuContent>
                                </ContextMenu>
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
                        className="focus-ring mt-px flex h-7.5 w-full items-center gap-1.5 rounded-md px-2.5 text-xs text-subtle-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent motion-reduce:transition-none"
                      >
                        <Plus
                          strokeWidth={ICON_STROKE}
                          aria-hidden="true"
                          className="size-3.5"
                        />
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

      {providers.length > 0 && (
        <div className="shrink-0 border-t border-border px-2 pt-2.5 pb-3">
          <p className="px-2 pb-1 text-micro font-medium text-subtle-foreground">
            Providers
          </p>
          <ul className="space-y-px">
            {providers.map((provider) => {
              const signedIn =
                providerAuth[provider.id]?.isAuthenticated ?? false;
              return (
                <li key={provider.id}>
                  <button
                    type="button"
                    onClick={() => openProvider(provider.id)}
                    className="focus-ring flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ui transition-colors hover:bg-accent/60 motion-reduce:transition-none"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${
                        signedIn ? "bg-success" : "bg-warning"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {provider.name}
                    </span>
                    <span
                      className={`text-micro ${
                        signedIn ? "text-muted-foreground" : "text-warning"
                      }`}
                    >
                      {signedIn ? "Signed in" : "Sign in"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ConfirmModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={
          deleteTarget?.type === "workspace"
            ? "Delete workspace"
            : "Delete session"
        }
        message={deleteMessage}
        confirmLabel={
          deleteTarget?.type === "workspace"
            ? "Delete workspace"
            : "Delete session"
        }
        onConfirm={handleDelete}
      />
    </aside>
  );
}
