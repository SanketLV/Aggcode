import {
  AddMessageSchema,
  CreateSessionSchema,
  CreateWorkspaceSchema,
  type IncomingMessageType,
  type Message,
  type OutgoingMessageType,
} from "commons/types";
import { SessionModel, WorkspaceModel } from "db/client";
import mongoose from "mongoose";
import { WebSocket } from "ws";

// Workspace paths arrive in whatever form the OS uses, so split on both separators.
function workspaceNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

export class User {
  private socket: WebSocket;
  public id: string;

  constructor(id: string, socket: WebSocket) {
    this.socket = socket;
    this.id = id;
  }

  async sendMessage(payload: OutgoingMessageType) {
    this.socket.send(JSON.stringify(payload));
  }

  async handleIncomingMessage(
    msg: IncomingMessageType,
  ): Promise<OutgoingMessageType> {
    if (msg.type === "create-workspace") {
      const parsed = CreateWorkspaceSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("create-workspace: invalid payload");
      }

      const { path } = parsed.data;
      const name = workspaceNameFromPath(path);
      const workspace = await WorkspaceModel.create({ path, name });

      return {
        type: "workspace-created",
        payload: {
          id: workspace._id.toString(),
          path,
          name,
        },
      };
    }

    if (msg.type === "create-session") {
      const parsed = CreateSessionSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("create-session: invalid payload");
      }

      const { workspaceId } = parsed.data;

      if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
        throw new Error("create-session: unknown workspace");
      }

      const workspace = await WorkspaceModel.findById(workspaceId);

      if (!workspace) {
        throw new Error("create-session: unknown workspace");
      }

      const session = await SessionModel.create({
        workspace: workspace._id,
        messages: [],
      });

      return {
        type: "session-created",
        payload: {
          id: session._id.toString(),
          workspaceId,
        },
      };
    }

    if (msg.type === "add-message") {
      const parsed = AddMessageSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("add-message: invalid payload");
      }

      const { sessionId, message } = parsed.data;

      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        throw new Error("add-message: unknown session");
      }

      const stored: Message = {
        role: "user",
        payload: { message },
      };

      const session = await SessionModel.findByIdAndUpdate(
        sessionId,
        { $push: { messages: stored } },
        { new: true },
      );

      if (!session) {
        throw new Error("add-message: unknown session");
      }

      return {
        type: "message-added",
        payload: {
          sessionId: session._id.toString(),
          message: stored,
        },
      };
    }

    throw new Error("Incorrect input schema");
  }
}
