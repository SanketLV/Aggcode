import z from "zod";

// An assistant turn is a transcript: prose blocks interleaved with the tools
// the agent ran, in the order they happened.
export const ToolStatusSchema = z.enum(["running", "done", "error"]);

export type ToolStatus = z.infer<typeof ToolStatusSchema>;

export const MessagePartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("tool"),
    // The API's tool_use block id. Correlates the call with its result, which
    // arrives in a later SDK message.
    toolId: z.string(),
    name: z.string(),
    detail: z.string(),
    status: ToolStatusSchema,
    output: z.string().optional(),
  }),
]);

export type MessagePart = z.infer<typeof MessagePartSchema>;

// `message` stays the plain final answer: it drives sidebar previews and is the
// only content on rows written before `parts` existed. Render `parts` when
// present, fall back to `message` when not.
export const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  payload: z.object({
    message: z.string(),
    parts: z.array(MessagePartSchema).optional(),
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

export const SessionRefSchema = z.object({
  sessionId: z.string(),
});

export type SessionRefSchemaType = z.infer<typeof SessionRefSchema>;

export const WorkspaceDeletedSchema = z.object({
  workspaceId: z.string(),
});

export type WorkspaceDeletedSchemaType = z.infer<typeof WorkspaceDeletedSchema>;

export const SessionDeletedSchema = z.object({
  sessionId: z.string(),
});

export type SessionDeletedSchemaType = z.infer<typeof SessionDeletedSchema>;

export const AssistantErrorSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
});

export type AssistantErrorSchemaType = z.infer<typeof AssistantErrorSchema>;

// A chunk of assistant prose as it is generated.
export const AssistantDeltaSchema = z.object({
  sessionId: z.string(),
  text: z.string(),
});

export type AssistantDeltaSchemaType = z.infer<typeof AssistantDeltaSchema>;

// A tool the agent just invoked. `detail` is a short human-readable target,
// e.g. the file it read. It starts life as `running`.
export const AssistantToolSchema = z.object({
  sessionId: z.string(),
  toolId: z.string(),
  name: z.string(),
  detail: z.string(),
});

export type AssistantToolSchemaType = z.infer<typeof AssistantToolSchema>;

// The outcome of an earlier `assistant-tool`, matched on `toolId`. This is the
// one frame that mutates an existing part rather than appending a new one.
export const AssistantToolResultSchema = z.object({
  sessionId: z.string(),
  toolId: z.string(),
  status: z.enum(["done", "error"]),
  output: z.string(),
});

export type AssistantToolResultSchemaType = z.infer<
  typeof AssistantToolResultSchema
>;

// Coarse progress for the run indicator. Deliberately not persisted: it is
// only meaningful while a run is in flight.
export const AssistantProgressSchema = z.object({
  sessionId: z.string(),
  thinkingTokens: z.number(),
});

export type AssistantProgressSchemaType = z.infer<
  typeof AssistantProgressSchema
>;

export type ModelOption = {
  id: string;
  name: string;
  supportsEffort?: boolean;
};

export type ProviderOption = {
  id: string;
  name: string;
  models: ModelOption[];
  defaultModel: string;
  effortLevels?: string[];
};

export type AuthField = {
  id: string;
  label: string;
  type: "text" | "password";
  placeholder?: string;
  required?: boolean;
  description?: string;
};

export type AuthMethodDescriptor = {
  id: string;
  label: string;
  type: "oauth" | "api_key" | "none";
  fields?: AuthField[];
  description?: string;
};

export type ProviderAuthStatus = {
  providerId: string;
  isAuthenticated: boolean;
  method?: string;
  accountName?: string;
  details?: string;
  connectedSubProviders?: string[];
  extra?: Record<string, unknown>;
};

export type ProviderDescriptor = {
  id: string;
  name: string;
  authMethods: AuthMethodDescriptor[];
  status: ProviderAuthStatus;
};

// One incoming `add-message` produces several outgoing messages over time:
// `message-added` (the user's echo), then `assistant-working`, then any number
// of `assistant-delta` / `assistant-tool` frames as the run progresses, then
// exactly one of `assistant-message` or `assistant-error`. Nothing else may
// close a run.
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
      providers?: ProviderOption[];
      providerAuth?: Record<string, ProviderAuthStatus>;
      providerDescriptors?: ProviderDescriptor[];
    }
  | {
      type: "session-config-updated";
      payload: {
        sessionId: string;
        provider: string;
        model?: string;
        effort?: string;
      };
    }
  | {
      type: "provider-auth-updated";
      payload: {
        statuses: Record<string, ProviderAuthStatus>;
        descriptors?: ProviderDescriptor[];
      };
    }
  | {
      type: "provider-auth-result";
      payload: {
        providerId: string;
        action: "login" | "logout";
        success: boolean;
        message?: string;
      };
    }
  | {
      type: "provider-catalog-updated";
      payload: {
        providers: ProviderOption[];
      };
    }
  | {
      type: "assistant-message";
      payload: MessageAddedSchemaType;
    }
  | {
      type: "assistant-working";
      payload: SessionRefSchemaType;
    }
  | {
      type: "assistant-error";
      payload: AssistantErrorSchemaType;
    }
  | {
      type: "assistant-delta";
      payload: AssistantDeltaSchemaType;
    }
  | {
      type: "assistant-tool";
      payload: AssistantToolSchemaType;
    }
  | {
      type: "assistant-tool-result";
      payload: AssistantToolResultSchemaType;
    }
  | {
      type: "assistant-progress";
      payload: AssistantProgressSchemaType;
    }
  | {
      type: "workspace-deleted";
      payload: WorkspaceDeletedSchemaType;
    }
  | {
      type: "session-deleted";
      payload: SessionDeletedSchemaType;
    };

export type Session = {
  id: string;
  messages: Message[];
  provider?: string;
  model?: string;
  effort?: string;
};

export type Workspace = {
  id: string;
  name: string;
  path: string;
  sessions: Session[];
};
