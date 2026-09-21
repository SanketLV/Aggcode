import {
  AddMessageSchema,
  CreateSessionSchema,
  CreateWorkspaceSchema,
  DeleteSessionSchema,
  DeleteWorkspaceSchema,
  GetProviderAuthSchema,
  ProviderLoginSchema,
  ProviderLogoutSchema,
  UpdateSessionConfigSchema,
  type IncomingMessageType,
  type Message,
  type MessagePart,
  type OutgoingMessageType,
} from "commons/types";
import { SessionModel, WorkspaceModel } from "db/client";
import mongoose from "mongoose";
import { WebSocket } from "ws";
import {
  CLAUDE_CATALOG,
  findProvider,
  getAuthSnapshot,
  getProvider,
  getProviderCatalog,
  resolveModel,
} from "./providers";
import { chatGateRejection } from "./providers/authScope";
import { buildHandoffTranscript } from "./providers/workspaceContext";

// Workspace paths arrive in whatever form the OS uses, so split on both separators.
function workspaceNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

// Guards against two runs racing on one session: they would clobber each
// other's session IDs and interleave their message writes. Process wide, so a
// second browser tab cannot bypass it either.
const activeRuns = new Set<string>();

export class User {
  private socket: WebSocket;
  public id: string;

  constructor(id: string, socket: WebSocket) {
    this.socket = socket;
    this.id = id;
  }

  // Not async: an agent run sends several frames, and a rejected promise from a
  // socket that closed mid-run would surface as an unhandled rejection.
  sendMessage(payload: OutgoingMessageType): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  // Returns null when the branch has already sent its own frames.
  async handleIncomingMessage(
    msg: IncomingMessageType,
  ): Promise<OutgoingMessageType | null> {
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

    if (msg.type === "update-session-config") {
      const parsed = UpdateSessionConfigSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("update-session-config: invalid payload");
      }

      const { sessionId, provider, model, effort } = parsed.data;

      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        throw new Error("update-session-config: unknown session");
      }

      await SessionModel.updateOne(
        { _id: sessionId },
        { $set: { provider, model, effort } },
      );

      return {
        type: "session-config-updated",
        payload: { sessionId, provider, model, effort },
      };
    }

    if (msg.type === "add-message") {
      const parsed = AddMessageSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("add-message: invalid payload");
      }

      const {
        sessionId,
        message,
        provider: requestedProvider,
        model: requestedModel,
        effort: requestedEffort,
      } = parsed.data;

      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        throw new Error("add-message: unknown session");
      }

      const stored: Message = {
        role: "user",
        payload: { message },
      };

      // Rejections below are reported as `assistant-error` rather than thrown:
      // a throw is only logged by UserManager, leaving the client with no idea
      // why its message vanished.
      const reject = (reason: string): null => {
        this.sendMessage({
          type: "assistant-error",
          payload: { sessionId, message: reason },
        });
        return null;
      };

      const session = await SessionModel.findById(sessionId);

      if (!session) {
        return reject("This session no longer exists. Reload the page.");
      }

      const workspace = await WorkspaceModel.findById(session.workspace);

      // Never fall through to the backend's own cwd: the agent runs with
      // `acceptEdits` and `Edit` allowed, so an unresolved workspace would let
      // it rewrite this repo instead of the user's project.
      if (!workspace?.path) {
        return reject(
          "This session has no workspace folder, so the agent cannot run.",
        );
      }

      if (activeRuns.has(sessionId)) {
        return reject(
          "This session is already running. Wait for it to finish.",
        );
      }

      const targetProvider = requestedProvider || session.provider || "claude";
      const rawModel = requestedModel || session.model || undefined;
      const targetModel =
        targetProvider === "claude"
          ? resolveModel(CLAUDE_CATALOG, rawModel)
          : rawModel;
      const targetEffort = requestedEffort || session.effort || undefined;

      // Chat needs a signed-in provider, even for OpenCode's free models
      // (product requirement).
      const gateRejection = await chatGateRejection(
        getProvider(targetProvider),
      );
      if (gateRejection) {
        return reject(gateRejection);
      }

      // Check for mid-conversation provider switch
      const isSwitch = Boolean(
        session.lastProvider && session.lastProvider !== targetProvider,
      );
      let historyContext: string | undefined;

      if (isSwitch && session.messages.length > 0) {
        console.log(
          `[session ${sessionId}] Provider switched from ${session.lastProvider} to ${targetProvider}. Reconstructing conversation context...`,
        );
        historyContext = buildHandoffTranscript(session.messages);
      }

      let resumeId: string | undefined;
      if (!isSwitch) {
        resumeId =
          targetProvider === "opencode"
            ? (session.opencodeSessionId ?? undefined)
            : (session.anthropicSessionId ?? undefined);
      }

      await SessionModel.updateOne(
        { _id: session._id },
        {
          $push: { messages: stored },
          $set: {
            provider: targetProvider,
            model: targetModel,
            effort: targetEffort,
            lastProvider: targetProvider,
            lastModel: targetModel,
          },
        },
      );

      // Echo the user's own message before the run starts, so it renders
      // immediately and always above whatever the agent produces.
      this.sendMessage({
        type: "message-added",
        payload: { sessionId, message: stored },
      });

      await this.runAgent({
        sessionId,
        workspaceId: workspace._id.toString(),
        cwd: workspace.path,
        prompt: message,
        providerId: targetProvider,
        model: targetModel,
        effort: targetEffort,
        resumeId,
        historyContext,
      });
      return null;
    }

    if (msg.type === "delete-workspace") {
      const parsed = DeleteWorkspaceSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("delete-workspace: invalid payload");
      }

      const { workspaceId } = parsed.data;

      if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
        throw new Error("delete-workspace: unknown workspace");
      }

      const workspace = await WorkspaceModel.findById(workspaceId);

      if (!workspace) {
        throw new Error("delete-workspace: unknown workspace");
      }

      // Cascade delete: remove all sessions belonging to this workspace
      await SessionModel.deleteMany({ workspace: workspaceId });
      await WorkspaceModel.findByIdAndDelete(workspaceId);

      return {
        type: "workspace-deleted",
        payload: { workspaceId },
      };
    }

    if (msg.type === "delete-session") {
      const parsed = DeleteSessionSchema.safeParse(msg.payload);

      if (!parsed.success) {
        throw new Error("delete-session: invalid payload");
      }

      const { sessionId } = parsed.data;

      if (!mongoose.Types.ObjectId.isValid(sessionId)) {
        throw new Error("delete-session: unknown session");
      }

      // Prevent deleting a session that has an active run
      if (activeRuns.has(sessionId)) {
        throw new Error("delete-session: session is currently running");
      }

      const session = await SessionModel.findByIdAndDelete(sessionId);

      if (!session) {
        throw new Error("delete-session: unknown session");
      }

      return {
        type: "session-deleted",
        payload: { sessionId },
      };
    }

    if (msg.type === "get-provider-auth") {
      const parsed = GetProviderAuthSchema.safeParse(msg.payload);
      if (!parsed.success) {
        throw new Error("get-provider-auth: invalid payload");
      }
      const { statuses, descriptors } = await getAuthSnapshot();
      return {
        type: "provider-auth-updated",
        payload: { statuses, descriptors },
      };
    }

    if (msg.type === "provider-login") {
      const parsed = ProviderLoginSchema.safeParse(msg.payload);
      if (!parsed.success) {
        throw new Error("provider-login: invalid payload");
      }
      const { providerId, method, credentials } = parsed.data;
      const provider = findProvider(providerId);
      if (!provider?.auth) {
        return {
          type: "provider-auth-result",
          payload: {
            providerId,
            action: "login",
            success: false,
            message: provider
              ? `Provider '${providerId}' does not support authentication.`
              : `Unknown provider '${providerId}'.`,
          },
        };
      }

      // A thrown error would leave the modal spinner running, since UserManager
      // only logs it; report it as a failed result instead.
      const result = await provider.auth
        .login({ method, credentials })
        .catch((err: unknown) => {
          console.error(`[${providerId} auth] ${msg.type} failed:`, err);
          return {
            success: false,
            message: err instanceof Error ? err.message : String(err),
          };
        });
      this.sendMessage({
        type: "provider-auth-result",
        payload: {
          providerId,
          action: "login",
          success: result.success,
          message: result.message,
        },
      });

      const { statuses, descriptors } = await getAuthSnapshot();
      this.sendMessage({
        type: "provider-auth-updated",
        payload: { statuses, descriptors },
      });

      const updatedCatalog = await getProviderCatalog();
      return {
        type: "provider-catalog-updated",
        payload: { providers: updatedCatalog },
      };
    }

    if (msg.type === "provider-logout") {
      const parsed = ProviderLogoutSchema.safeParse(msg.payload);
      if (!parsed.success) {
        throw new Error("provider-logout: invalid payload");
      }
      const { providerId, target } = parsed.data;
      const provider = findProvider(providerId);
      if (!provider?.auth) {
        return {
          type: "provider-auth-result",
          payload: {
            providerId,
            action: "logout",
            success: false,
            message: provider
              ? `Provider '${providerId}' does not support authentication.`
              : `Unknown provider '${providerId}'.`,
          },
        };
      }

      // A thrown error would leave the modal spinner running, since UserManager
      // only logs it; report it as a failed result instead.
      const result = await provider.auth
        .logout({ target })
        .catch((err: unknown) => {
          console.error(`[${providerId} auth] ${msg.type} failed:`, err);
          return {
            success: false,
            message: err instanceof Error ? err.message : String(err),
          };
        });
      this.sendMessage({
        type: "provider-auth-result",
        payload: {
          providerId,
          action: "logout",
          success: result.success,
          message: result.message,
        },
      });

      const { statuses, descriptors } = await getAuthSnapshot();
      this.sendMessage({
        type: "provider-auth-updated",
        payload: { statuses, descriptors },
      });

      const updatedCatalog = await getProviderCatalog();
      return {
        type: "provider-catalog-updated",
        payload: { providers: updatedCatalog },
      };
    }

    throw new Error("Incorrect input schema");
  }

  private async runAgent(params: {
    sessionId: string;
    workspaceId: string;
    cwd: string;
    prompt: string;
    providerId: string;
    model?: string;
    effort?: string;
    resumeId?: string;
    historyContext?: string;
  }): Promise<void> {
    const {
      sessionId,
      workspaceId,
      cwd,
      prompt,
      providerId,
      model,
      effort,
      resumeId,
      historyContext,
    } = params;
    activeRuns.add(sessionId);
    this.sendMessage({ type: "assistant-working", payload: { sessionId } });

    let settled = false;

    // Accumulated live transcript. Streamed to the client frame by frame and
    // persisted once, at settle, so the reload matches what the user watched.
    const parts: MessagePart[] = [];

    const pushText = (chunk: string): void => {
      const last = parts[parts.length - 1];
      if (last?.type === "text") {
        last.text += chunk;
      } else {
        parts.push({ type: "text", text: chunk });
      }
      this.sendMessage({
        type: "assistant-delta",
        payload: { sessionId, text: chunk },
      });
    };

    const pushTool = (toolId: string, name: string, detail: string): void => {
      parts.push({ type: "tool", toolId, name, detail, status: "running" });
      this.sendMessage({
        type: "assistant-tool",
        payload: { sessionId, toolId, name, detail },
      });
    };

    const resolveTool = (result: {
      toolId: string;
      status: "done" | "error";
      output: string;
    }): void => {
      const part = parts.find(
        (candidate) =>
          candidate.type === "tool" && candidate.toolId === result.toolId,
      );

      // A result for a tool_start we never saw has nothing to attach to.
      if (!part || part.type !== "tool") {
        return;
      }

      part.status = result.status;
      part.output = result.output;

      this.sendMessage({
        type: "assistant-tool-result",
        payload: {
          sessionId,
          toolId: result.toolId,
          status: result.status,
          output: result.output,
        },
      });
    };

    const settle = async (text: string, isError: boolean): Promise<void> => {
      if (settled) {
        return;
      }
      settled = true;

      if (isError) {
        // Failures are not part of the conversation, so they are not stored:
        // persisting them would feed the error back as context on the next
        // `resume`, and the true record is a user message with no reply.
        this.sendMessage({
          type: "assistant-error",
          payload: { sessionId, message: text },
        });
        return;
      }

      // Safety net: if no text ever streamed (partial messages unavailable, or
      // a run that only called tools), the final answer would otherwise be
      // missing from the transcript entirely.
      if (!parts.some((part) => part.type === "text")) {
        parts.push({ type: "text", text });
      }

      // The turn is over, so nothing can still be running. Without this a tool
      // whose result never arrived would spin forever in the transcript.
      for (const part of parts) {
        if (part.type === "tool" && part.status === "running") {
          part.status = "done";
        }
      }

      const assistant: Message = {
        role: "assistant",
        payload: { message: text, parts },
      };

      // Persist before sending: a socket that dropped mid-run costs the live
      // update, never the data.
      await SessionModel.updateOne(
        { _id: sessionId },
        { $push: { messages: assistant } },
      );

      this.sendMessage({
        type: "assistant-message",
        payload: { sessionId, message: assistant },
      });
    };

    try {
      const provider = getProvider(providerId);

      for await (const event of provider.runAgent({
        prompt,
        cwd,
        workspaceId,
        sessionId,
        resumeId,
        model,
        effort,
        historyContext,
      })) {
        switch (event.type) {
          case "text_delta":
            pushText(event.text);
            break;

          case "tool_start":
            pushTool(event.toolId, event.name, event.detail);
            break;

          case "tool_result":
            resolveTool(event);
            break;

          case "thinking_tokens":
            this.sendMessage({
              type: "assistant-progress",
              payload: { sessionId, thinkingTokens: event.tokens },
            });
            break;

          case "success":
            if (event.sessionId) {
              if (providerId === "opencode") {
                await SessionModel.updateOne(
                  { _id: sessionId },
                  { $set: { opencodeSessionId: event.sessionId } },
                );
              } else {
                await SessionModel.updateOne(
                  { _id: sessionId },
                  { $set: { anthropicSessionId: event.sessionId } },
                );
              }
            }
            await settle(event.text, false);
            break;

          case "error":
            await settle(event.message, true);
            break;
        }
      }
    } catch (error) {
      console.error("Agent run failed for session " + sessionId, error);
      await settle(
        error instanceof Error ? error.message : String(error),
        true,
      );
    } finally {
      // The client clears its working indicator only on a terminal frame, so
      // one must go out on every path.
      if (!settled) {
        await settle("The agent exited without returning a result.", true);
      }
      activeRuns.delete(sessionId);
    }
  }
}
