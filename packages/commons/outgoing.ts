import z from "zod";

export const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  payload: z.object({
    message: z.string(),
  }),
});

export type Message = z.infer<typeof MessageSchema>;

export const WorkspaceCreatedSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
});

export type WorkspaceCreatedSchemaType = z.infer<typeof WorkspaceCreatedSchema>;

export const SessionCreatedSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
});

export type SessionCreatedSchemaType = z.infer<typeof SessionCreatedSchema>;

export const MessageAddedSchema = z.object({
  sessionId: z.string(),
  message: MessageSchema,
});

export type MessageAddedSchemaType = z.infer<typeof MessageAddedSchema>;

export type OutgoingMessageType =
  | {
      type: "workspace-created";
      payload: WorkspaceCreatedSchemaType;
    }
  | {
      type: "session-created";
      payload: SessionCreatedSchemaType;
    }
  | {
      type: "message-added";
      payload: MessageAddedSchemaType;
    }
  | {
      type: "init";
      workspaces: Workspace[];
    };

export type Session = {
  id: string;
  messages: Message[];
};

export type Workspace = {
  id: string;
  name: string;
  path: string;
  sessions: Session[];
};
