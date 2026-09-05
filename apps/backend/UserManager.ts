import { WebSocket } from "ws";
import { User } from "./User";
import { uuid } from "uuidv4";
import { SessionModel, WorkspaceModel } from "db/client";
import type { MessagePart, Workspace } from "commons/types";
import { getProviderCatalog } from "./providers";

// The stored subdocument keeps both part kinds in one flat shape, so narrow it
// back to the discriminated union on the way out. Unknown kinds are dropped
// rather than shipped as malformed parts.
type StoredPart = {
  type?: string | null;
  text?: string | null;
  toolId?: string | null;
  name?: string | null;
  detail?: string | null;
  status?: string | null;
  output?: string | null;
};

function toMessageParts(
  stored: StoredPart[] | null | undefined,
): MessagePart[] | undefined {
  if (!stored || stored.length === 0) {
    return undefined;
  }

  const parts = stored.flatMap<MessagePart>((part) => {
    if (part.type === "text") {
      return [{ type: "text", text: part.text ?? "" }];
    }
    if (part.type === "tool") {
      return [
        {
          type: "tool",
          toolId: part.toolId ?? "",
          name: part.name ?? "",
          detail: part.detail ?? "",
          // Rows written before tools carried a status are finished by
          // definition. Nothing stored can still be running.
          status: part.status === "error" ? "error" : "done",
          ...(part.output ? { output: part.output } : {}),
        },
      ];
    }
    return [];
  });

  return parts.length > 0 ? parts : undefined;
}

export class UserManager {
  private users: User[];
  private static instance: UserManager;

  private constructor() {
    this.users = [];
  }

  static getInstance(): UserManager {
    if (UserManager.instance) {
      return UserManager.instance;
    }

    UserManager.instance = new UserManager();
    return UserManager.instance;
  }

  async addUser(ws: WebSocket) {
    const id = uuid();
    const user = new User(id, ws);
    this.users.push(user);

    // Listeners are attached before the initial load so nothing sent during it is dropped.
    ws.on("message", async (msg) => {
      try {
        const parsedMessage = JSON.parse(msg.toString());
        const responsePayload = await user.handleIncomingMessage(parsedMessage);
        // Null means the branch already sent its own frames (see `add-message`).
        if (responsePayload) {
          user.sendMessage(responsePayload);
        }
      } catch (error) {
        console.log(msg.toString());
        console.error(error);
      }
    });

    ws.on("close", () => {
      this.users = this.users.filter((x) => x.id != id);
    });

    try {
      await this.sendInitialState(user);
    } catch (error) {
      console.error("Failed to send initial state", error);
      ws.close();
    }
  }

  private async sendInitialState(user: User) {
    const [workspaces, sessions, providers] = await Promise.all([
      WorkspaceModel.find(),
      SessionModel.find(),
      getProviderCatalog(),
    ]);

    const response: Workspace[] = workspaces.map((w) => ({
      id: w._id.toString(),
      name: w.name ?? "",
      path: w.path ?? "",
      sessions: sessions
        .filter((s) => s.workspace?.toString() === w._id.toString())
        .map((s) => ({
          id: s._id.toString(),
          provider: s.provider ?? "claude",
          model: s.model ?? undefined,
          effort: s.effort ?? undefined,
          // Every field of a stored message has to be mapped through here, or
          // it silently vanishes on reload while working fine live.
          messages: s.messages.map((m) => ({
            role:
              m.role === "assistant"
                ? ("assistant" as const)
                : ("user" as const),
            payload: {
              message: m.payload?.message ?? "",
              parts: toMessageParts(m.payload?.parts),
            },
          })),
        })),
    }));

    user.sendMessage({ type: "init", workspaces: response, providers });
  }
}
