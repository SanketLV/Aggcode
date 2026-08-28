import { WebSocket } from "ws";
import { User } from "./User";
import { uuid } from "uuidv4";
import { SessionModel, WorkspaceModel } from "db/client";
import type { Workspace } from "commons/types";

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
        user.sendMessage(responsePayload);
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
    const [workspaces, sessions] = await Promise.all([
      WorkspaceModel.find(),
      SessionModel.find(),
    ]);

    const response: Workspace[] = workspaces.map((w) => ({
      id: w._id.toString(),
      name: w.name ?? "",
      path: w.path ?? "",
      sessions: sessions
        .filter((s) => s.workspace?.toString() === w._id.toString())
        .map((s) => ({
          id: s._id.toString(),
          messages: s.messages.map((m) => ({
            role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
            payload: { message: m.payload?.message ?? "" },
          })),
        })),
    }));

    user.sendMessage({ type: "init", workspaces: response });
  }
}
