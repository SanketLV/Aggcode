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
  provider: z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),
});

export type AddMessageSchemaType = z.infer<typeof AddMessageSchema>;

export const UpdateSessionConfigSchema = z.object({
  sessionId: z.string(),
  provider: z.string(),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high", "max"]).optional(),
});

export type UpdateSessionConfigSchemaType = z.infer<
  typeof UpdateSessionConfigSchema
>;

export const DeleteWorkspaceSchema = z.object({
  workspaceId: z.string(),
});

export type DeleteWorkspaceSchemaType = z.infer<typeof DeleteWorkspaceSchema>;

export const DeleteSessionSchema = z.object({
  sessionId: z.string(),
});

export type DeleteSessionSchemaType = z.infer<typeof DeleteSessionSchema>;

export const ProviderLoginSchema = z.object({
  providerId: z.string(),
  method: z.string(),
  credentials: z.record(z.string(), z.string()).optional(),
});

export type ProviderLoginSchemaType = z.infer<typeof ProviderLoginSchema>;

export const ProviderLogoutSchema = z.object({
  providerId: z.string(),
  target: z.string().optional(),
});

export type ProviderLogoutSchemaType = z.infer<typeof ProviderLogoutSchema>;

export const GetProviderAuthSchema = z.object({
  providerId: z.string().optional(),
});

export type GetProviderAuthSchemaType = z.infer<typeof GetProviderAuthSchema>;

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
    }
  | {
      type: "update-session-config";
      payload: UpdateSessionConfigSchemaType;
    }
  | {
      type: "delete-workspace";
      payload: DeleteWorkspaceSchemaType;
    }
  | {
      type: "delete-session";
      payload: DeleteSessionSchemaType;
    }
  | {
      type: "provider-login";
      payload: ProviderLoginSchemaType;
    }
  | {
      type: "provider-logout";
      payload: ProviderLogoutSchemaType;
    }
  | {
      type: "get-provider-auth";
      payload: GetProviderAuthSchemaType;
    };
