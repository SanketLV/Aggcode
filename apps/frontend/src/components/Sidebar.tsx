import { useState } from "react";
import { ChevronRight, Plus, Trash } from "lucide-react";
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
  } = useApp();
  const [path, setPath] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "workspace" | "session";
    id: string;
    name: string;
  } | null>(null);

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

  const openDeleteModal = (
    type: "workspace" | "session",
    id: string,
    name: string,
  ) => {
    setDeleteTarget({ type, id, name });
    setDeleteModalOpen(true);
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

    setDeleteModalOpen(false);
    setDeleteTarget(null);
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-x-hidden border-r border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight">Aggcode</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {online ? "Connected" : "Connection lost. Reload to reconnect."}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2">
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
                <ContextMenu key={workspace.id}>
                  <li className="min-w-0">
                    <ContextMenuTrigger asChild>
                      <div className="min-w-0">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setOpenWorkspaceId(isOpen ? null : workspace.id)
                          }
                          className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
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
                            <span
                              title={workspace.path}
                              className="block truncate font-mono text-[11px] text-muted-foreground"
                            >
                              {workspace.path}
                            </span>
                          </span>
                        </button>
                      </div>
                    </ContextMenuTrigger>

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
                                <ContextMenu key={session.id}>
                                  <ContextMenuTrigger asChild>
                                    <li className="min-w-0">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setActiveSessionId(session.id)
                                        }
                                        className={`block w-full min-w-0 truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none ${
                                          isActive
                                            ? "bg-accent text-accent-foreground"
                                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                        }`}
                                      >
                                        {label}
                                      </button>
                                    </li>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent>
                                    <ContextMenuItem
                                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                      onSelect={() =>
                                        openDeleteModal(
                                          "session",
                                          session.id,
                                          label,
                                        )
                                      }
                                    >
                                      <Trash
                                        strokeWidth={ICON_STROKE}
                                        className="size-3.5"
                                      />
                                      Delete session
                                    </ContextMenuItem>
                                  </ContextMenuContent>
                                </ContextMenu>
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
                          <Plus
                            strokeWidth={ICON_STROKE}
                            className="size-3.5"
                          />
                          New session
                        </button>
                      </div>
                    )}
                  </li>
                  <ContextMenuContent>
                    <ContextMenuItem
                      className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                      onSelect={() =>
                        openDeleteModal(
                          "workspace",
                          workspace.id,
                          workspace.name,
                        )
                      }
                    >
                      <Trash strokeWidth={ICON_STROKE} className="size-3.5" />
                      Delete workspace
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
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
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px disabled:opacity-50 motion-reduce:transition-none"
          >
            Add
          </button>
        </div>
      </form>

      <ConfirmModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        title={
          deleteTarget?.type === "workspace"
            ? "Delete Workspace"
            : "Delete Session"
        }
        message={
          deleteTarget?.type === "workspace"
            ? `Are you sure you want to delete "${deleteTarget?.name}" and all its sessions? This action cannot be undone.`
            : "Are you sure you want to delete this session? This action cannot be undone."
        }
        onConfirm={handleDelete}
      />
    </aside>
  );
}
