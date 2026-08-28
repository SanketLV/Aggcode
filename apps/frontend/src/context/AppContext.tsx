import type { Workspace } from "commons/types";
import { createContext, type Dispatch, type SetStateAction } from "react";
import type { SocketStatus } from "../hooks/useSocket";

// A workspace the user just submitted has no server id yet, so it is held
// locally as `pending` until `workspace-created` comes back.
export type UiWorkspace = Workspace & { pending?: boolean };

type AppContextValue = {
  workspaces: UiWorkspace[];
  setWorkspaces: Dispatch<SetStateAction<UiWorkspace[]>>;
  socket: WebSocket | null;
  status: SocketStatus;
  activeSessionId: string | null;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  openWorkspaceId: string | null;
  setOpenWorkspaceId: Dispatch<SetStateAction<string | null>>;
};

export const AppContext = createContext<AppContextValue>({
  workspaces: [],
  setWorkspaces: () => {},
  socket: null,
  status: "connecting",
  activeSessionId: null,
  setActiveSessionId: () => {},
  openWorkspaceId: null,
  setOpenWorkspaceId: () => {},
});
