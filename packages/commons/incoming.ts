import z from "zod";

export const CreateWorkspaceSchema = z.object({
  path: z.string().trim().min(1),
});

export type CreateWorkspaceSchemaType = z.infer<typeof CreateWorkspaceSchema>;

export const CreateSessionSchema = z.object({
  workspaceId: z.string(),
});

export type CreateSessionSchemaType = z.infer<typeof CreateSessionSchema>;

export const AddMessageSchema = z.object({
  sessionId: z.string(),
  message: z.string().trim().min(1),
});

export type AddMessageSchemaType = z.infer<typeof AddMessageSchema>;

export type IncomingMessageType =
  | {
      type: "create-session";
      payload: CreateSessionSchemaType;
    }
  | {
      type: "create-workspace";
      payload: CreateWorkspaceSchemaType;
    }
  | {
      type: "add-message";
      payload: AddMessageSchemaType;
    };
