import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, MessageSquare } from "lucide-react";
import { ICON_STROKE } from "../constants";
import { composerPlaceholder } from "../lib/composer";
import { useApp } from "../context/AppContext";
import { send, partsOf } from "../lib/helpers";
import type { ToolPart } from "../types";
import { AssistantTurn } from "./AssistantTurn";
import { RunIndicator } from "./RunIndicator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function ChatPane() {
  const {
    socket,
    status,
    workspaces,
    activeSessionId,
    workingSessionIds,
    sessionErrors,
    liveTurns,
    runStartedAt,
    thinkingTokens,
    providers,
    providerAuth,
    setAuthModalOpen,
    setAuthModalProviderId,
    updateSessionConfig,
  } = useApp();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const online = status === "open";

  const active = useMemo(() => {
    for (const workspace of workspaces) {
      const session = workspace.sessions.find((s) => s.id === activeSessionId);
      if (session) {
        return { workspace, session };
      }
    }
    return null;
  }, [workspaces, activeSessionId]);

  const messageCount = active?.session.messages.length ?? 0;
  const isWorking =
    active !== null && workingSessionIds.includes(active.session.id);
  const error = active === null ? undefined : sessionErrors[active.session.id];
  const liveTurn = active === null ? undefined : liveTurns[active.session.id];
  const activeTool = liveTurn
    ?.filter((part): part is ToolPart => part.type === "tool")
    .find((part) => part.status === "running");

  const liveLength = liveTurn
    ? liveTurn.reduce(
        (n, part) => n + (part.type === "text" ? part.text.length : 1),
        0,
      )
    : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messageCount, activeSessionId, isWorking, error, liveLength]);

  if (!active) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <MessageSquare
            strokeWidth={ICON_STROKE}
            className="mx-auto size-6 text-muted-foreground"
          />
          <h2 className="mt-3 text-sm font-medium">No session open</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a workspace on the left, then pick one of its sessions or
            create a new one.
          </p>
        </div>
      </main>
    );
  }

  const currentProvider = active?.session.provider || "claude";
  const providerInfo = providers.find((p) => p.id === currentProvider);
  const availableModels = providerInfo?.models || [];
  // A session saved with a since-retired model would otherwise show a blank
  // picker; the backend runs such sessions on the default model too.
  const savedModel = active?.session.model;
  const currentModel =
    (savedModel && availableModels.some((m) => m.id === savedModel)
      ? savedModel
      : undefined) ||
    providerInfo?.defaultModel ||
    availableModels[0]?.id ||
    "";
  const currentEffort = active?.session.effort || "high";

  const selectedModelInfo = availableModels.find((m) => m.id === currentModel);
  const supportsEffort = selectedModelInfo?.supportsEffort ?? false;

  const currentProviderAuth = providerAuth[currentProvider];
  const isCurrentProviderAuth = currentProviderAuth?.isAuthenticated ?? false;
  const canChat = online && !isWorking && isCurrentProviderAuth;

  const handleProviderChange = (newProvider: string) => {
    if (!active) return;
    const targetProv = providers.find((p) => p.id === newProvider);
    const newModel =
      targetProv?.defaultModel || targetProv?.models[0]?.id || "";
    updateSessionConfig(active.session.id, {
      provider: newProvider,
      model: newModel,
      effort: currentEffort,
    });
  };

  const handleModelChange = (newModel: string) => {
    if (!active) return;
    updateSessionConfig(active.session.id, {
      provider: currentProvider,
      model: newModel,
      effort: currentEffort,
    });
  };

  const handleEffortChange = (newEffort: string) => {
    if (!active) return;
    updateSessionConfig(active.session.id, {
      provider: currentProvider,
      model: currentModel,
      effort: newEffort,
    });
  };

  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed === "" || !online || isWorking || !isCurrentProviderAuth) {
      return;
    }

    const sent = send(socket, {
      type: "add-message",
      payload: {
        sessionId: active.session.id,
        message: trimmed,
        provider: currentProvider,
        model: currentModel || undefined,
        effort: supportsEffort ? (currentEffort as any) : undefined,
      },
    });

    if (sent) {
      setDraft("");
    }
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-baseline gap-2 border-b border-border px-5 py-3">
        <span className="truncate text-sm font-medium">
          {active.workspace.name}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {active.workspace.path}
        </span>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {active.session.messages.length === 0 &&
        !isWorking &&
        !error &&
        !liveTurn ? (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Nothing in this session yet. Send the first message.
          </p>
        ) : (
          <ol className="mx-auto flex max-w-4xl flex-col gap-6">
            {active.session.messages.map((message, index) => (
              <li
                key={index}
                className={
                  message.role === "user"
                    ? "flex justify-end"
                    : "flex justify-start"
                }
              >
                {message.role === "user" ? (
                  <div className="max-w-[80%] rounded-lg bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
                    <p className="wrap-break-word whitespace-pre-wrap">
                      {message.payload.message}
                    </p>
                  </div>
                ) : (
                  <AssistantTurn parts={partsOf(message)} />
                )}
              </li>
            ))}

            {liveTurn && liveTurn.length > 0 && (
              <li className="flex justify-start" aria-live="polite">
                <AssistantTurn parts={liveTurn} />
              </li>
            )}

            {isWorking && (
              <li className="flex justify-start">
                <RunIndicator
                  startedAt={runStartedAt[active.session.id]}
                  thinkingTokens={thinkingTokens[active.session.id]}
                  activeTool={activeTool}
                />
              </li>
            )}

            {error && (
              <li className="flex justify-start" aria-live="polite">
                <div className="max-w-[80%] rounded-lg border border-destructive/40 bg-muted px-3.5 py-2.5 text-sm text-destructive">
                  <p className="wrap-break-word whitespace-pre-wrap">{error}</p>
                </div>
              </li>
            )}
          </ol>
        )}
      </div>

      <form
        className="shrink-0 border-t border-border px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {providers.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-4xl flex-wrap items-center gap-2">
            {/* Provider */}
            <Select
              value={currentProvider}
              onValueChange={handleProviderChange}
              disabled={isWorking || !online}
            >
              <SelectTrigger
                size="sm"
                className="h-7 text-xs bg-muted/40 hover:bg-muted/70 border-border"
              >
                <span className="text-muted-foreground mr-1">Provider:</span>
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Provider Auth Status Button */}
            <button
              type="button"
              onClick={() => {
                setAuthModalProviderId(currentProvider);
                setAuthModalOpen(true);
              }}
              className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium border transition-colors motion-reduce:transition-none ${
                isCurrentProviderAuth
                  ? "border-success/30 bg-success/10 text-success hover:bg-success/20"
                  : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20"
              }`}
              title={
                isCurrentProviderAuth
                  ? currentProviderAuth?.details || "Authenticated"
                  : "Not authenticated. Click to sign in."
              }
            >
              <span
                className={`size-1.5 rounded-full ${
                  isCurrentProviderAuth ? "bg-success" : "bg-warning"
                }`}
              />
              <span>{isCurrentProviderAuth ? "Signed In" : "Sign In"}</span>
            </button>

            {/* Model */}
            <Select
              value={currentModel}
              onValueChange={handleModelChange}
              disabled={isWorking || !online || availableModels.length === 0}
            >
              <SelectTrigger
                size="sm"
                className="h-7 max-w-[280px] text-xs bg-muted/40 hover:bg-muted/70 border-border truncate"
              >
                <span className="text-muted-foreground mr-1">Model:</span>
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Effort */}
            {supportsEffort && (
              <Select
                value={currentEffort}
                onValueChange={handleEffortChange}
                disabled={isWorking || !online}
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 text-xs bg-muted/40 hover:bg-muted/70 border-border"
                >
                  <span className="text-muted-foreground mr-1">Effort:</span>
                  <SelectValue placeholder="Effort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low" className="text-xs">
                    Low
                  </SelectItem>
                  <SelectItem value="medium" className="text-xs">
                    Medium
                  </SelectItem>
                  <SelectItem value="high" className="text-xs">
                    High
                  </SelectItem>
                  <SelectItem value="max" className="text-xs">
                    Max
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        <div className="mx-auto flex max-w-4xl items-end gap-2">
          <label htmlFor="composer" className="sr-only">
            Message
          </label>
          <textarea
            id="composer"
            rows={1}
            value={draft}
            disabled={isWorking || !isCurrentProviderAuth}
            placeholder={composerPlaceholder({
              signedIn: isCurrentProviderAuth,
              working: isWorking,
              providerName: providerInfo?.name || currentProvider,
            })}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="max-h-32 min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 field-sizing-content"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={
              !online ||
              isWorking ||
              draft.trim() === "" ||
              !isCurrentProviderAuth
            }
            className="rounded-md bg-primary p-2 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px disabled:opacity-50 motion-reduce:transition-none"
          >
            <ArrowUp strokeWidth={ICON_STROKE} className="size-4" />
          </button>
        </div>
        {!online ? (
          <p className="mx-auto mt-2 max-w-4xl text-xs text-muted-foreground">
            Disconnected from the server, so messages cannot be saved.
          </p>
        ) : !isCurrentProviderAuth ? (
          <p className="mx-auto mt-2 max-w-4xl text-xs text-warning">
            {currentProviderAuth?.details ||
              `Not signed in to ${currentProvider}. Connect a provider to enable chat.`}{" "}
            {currentProviderAuth?.connectedSubProviders &&
              currentProviderAuth.connectedSubProviders.length > 0 && (
                <span className="text-muted-foreground">
                  • Connected {currentProviderAuth.connectedSubProviders.length}{" "}
                  provider(s):{" "}
                  {currentProviderAuth.connectedSubProviders.join(", ")}
                </span>
              )}
          </p>
        ) : isWorking ? (
          <p className="mx-auto mt-2 max-w-4xl text-xs text-muted-foreground">
            The agent is still working on this session. One turn at a time.
          </p>
        ) : currentProviderAuth?.connectedSubProviders &&
          currentProviderAuth.connectedSubProviders.length > 0 ? (
          <p className="mx-auto mt-2 max-w-4xl text-xs text-muted-foreground">
            Connected {currentProviderAuth.connectedSubProviders.length}{" "}
            provider(s): {currentProviderAuth.connectedSubProviders.join(", ")}
          </p>
        ) : null}
      </form>
    </main>
  );
}
