import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  ChevronRight,
  MessageSquare,
  MessagesSquare,
} from "lucide-react";
import { ICON_STROKE } from "../constants";
import { findModel } from "commons/model-rules";
import { composerHint, composerPlaceholder } from "../lib/composer";
import { effortOptions, shownEffort } from "../lib/effort";
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

// Starting points that work in any repository, so they never name a file
// the workspace doesn't have.
const EXAMPLE_PROMPTS = [
  "Explain how this project is structured and where to start reading",
  "Run the tests and fix whatever is failing",
  "Find code that has no tests and add some for the riskiest part",
];

const CHIP_TRIGGER =
  "h-7 gap-1.5 border-0 bg-transparent px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground";

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
  const composerRef = useRef<HTMLTextAreaElement>(null);

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
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="h-14 shrink-0 border-b border-border" />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <MessagesSquare
              strokeWidth={ICON_STROKE}
              aria-hidden="true"
              className="mx-auto size-5 text-subtle-foreground"
            />
            <h2 className="mt-3 text-title font-semibold">No session open</h2>
            <p className="mt-1 text-ui text-muted-foreground">
              Open a workspace on the left, then pick one of its sessions or
              start a new one.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const currentProvider = active.session.provider || "claude";
  const providerInfo = providers.find((p) => p.id === currentProvider);
  const providerName = providerInfo?.name || currentProvider;
  const availableModels = providerInfo?.models || [];
  // A session saved with a since-retired model would otherwise show a blank
  // picker; the backend runs such sessions on the default model too.
  const savedModel = active.session.model;
  // Matched by the same rule the backend uses, so a session saved on an id the
  // catalog now names with a date still shows the model it will run on.
  const currentModel =
    findModel(availableModels, savedModel)?.id ||
    providerInfo?.defaultModel ||
    availableModels[0]?.id ||
    "";

  const selectedModelInfo = availableModels.find((m) => m.id === currentModel);
  const effortChoices = effortOptions(selectedModelInfo);
  const supportsEffort = effortChoices.length > 0;
  // The level a run will use for this model, not necessarily the saved one.
  const currentEffort =
    shownEffort(selectedModelInfo, active.session.effort) ||
    active.session.effort ||
    "high";

  const currentProviderAuth = providerAuth[currentProvider];
  const isCurrentProviderAuth = currentProviderAuth?.isAuthenticated ?? false;
  const canSend =
    online && !isWorking && isCurrentProviderAuth && draft.trim() !== "";

  const hint = composerHint({
    online,
    signedIn: isCurrentProviderAuth,
    working: isWorking,
    providerName,
    authDetails: currentProviderAuth?.details,
  });

  const title = active.session.messages[0]?.payload.message ?? "New session";
  const isEmpty =
    active.session.messages.length === 0 && !isWorking && !error && !liveTurn;

  const handleProviderChange = (newProvider: string) => {
    const targetProv = providers.find((p) => p.id === newProvider);
    const newModel =
      targetProv?.defaultModel || targetProv?.models[0]?.id || "";
    updateSessionConfig(active.session.id, {
      provider: newProvider,
      model: newModel,
      effort: effortFor(targetProv?.models, newModel),
    });
  };

  // The stored effort follows the model, so the config that is saved is the
  // one that will run.
  const effortFor = (
    models: typeof availableModels | undefined,
    modelId: string,
  ) =>
    shownEffort(
      models?.find((m) => m.id === modelId),
      active.session.effort,
    ) ||
    active.session.effort ||
    "high";

  const handleModelChange = (newModel: string) => {
    updateSessionConfig(active.session.id, {
      provider: currentProvider,
      model: newModel,
      effort: effortFor(availableModels, newModel),
    });
  };

  const handleEffortChange = (newEffort: string) => {
    updateSessionConfig(active.session.id, {
      provider: currentProvider,
      model: currentModel,
      effort: newEffort,
    });
  };

  const openSignIn = () => {
    setAuthModalProviderId(currentProvider);
    setAuthModalOpen(true);
  };

  const applyExample = (prompt: string) => {
    setDraft(prompt);
    composerRef.current?.focus();
  };

  const submit = () => {
    if (!canSend) {
      return;
    }

    const sent = send(socket, {
      type: "add-message",
      payload: {
        sessionId: active.session.id,
        message: draft.trim(),
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
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <h2 className="max-w-xl min-w-0 truncate text-title font-semibold">
            {title}
          </h2>
          <span className="shrink-0 text-xs text-muted-foreground">
            {active.workspace.name}
          </span>
          <span
            title={active.workspace.path}
            className="truncate font-mono text-micro text-subtle-foreground"
          >
            {active.workspace.path}
          </span>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
        {isEmpty ? (
          <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-6 py-10">
            <div>
              <div
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-lg border border-border-strong bg-muted text-muted-foreground"
              >
                <MessageSquare strokeWidth={ICON_STROKE} className="size-4.5" />
              </div>
              <h3 className="mt-4 text-display font-semibold">
                What should we change in {active.workspace.name}?
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                The agent works inside{" "}
                <span className="font-mono text-xs text-foreground/85">
                  {active.workspace.path}
                </span>{" "}
                and can read and edit files there. Edits are applied without
                asking.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-subtle-foreground">
                Try one of these
              </p>
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => applyExample(prompt)}
                  className="focus-ring flex min-h-10 items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 text-left text-ui text-foreground/85 transition-colors hover:border-border-strong hover:bg-accent/60 hover:text-foreground motion-reduce:transition-none"
                >
                  <span className="flex-1">{prompt}</span>
                  <ChevronRight
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-subtle-foreground"
                  />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
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
                  <div className="max-w-[80%] rounded-lg bg-muted px-3.5 py-2.5 text-sm text-foreground">
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
              <li aria-live="polite">
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
                  <AlertCircle
                    strokeWidth={ICON_STROKE}
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <p className="wrap-break-word whitespace-pre-wrap">{error}</p>
                </div>
              </li>
            )}
          </ol>
        )}
      </div>

      <form
        className="shrink-0 px-5 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border border-border-strong bg-card shadow-composer transition-colors focus-within:border-ring/60 motion-reduce:transition-none">
            <label htmlFor="composer" className="sr-only">
              Message
            </label>
            <textarea
              id="composer"
              ref={composerRef}
              rows={2}
              value={draft}
              disabled={isWorking || !isCurrentProviderAuth}
              placeholder={composerPlaceholder({
                signedIn: isCurrentProviderAuth,
                working: isWorking,
                providerName,
                workspaceName: active.workspace.name,
              })}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="field-sizing-content block max-h-48 min-h-16 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm text-foreground outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed"
            />

            <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-2">
              {providers.length > 0 && (
                <Select
                  value={currentProvider}
                  onValueChange={handleProviderChange}
                  disabled={isWorking || !online}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Provider"
                    className={CHIP_TRIGGER}
                  >
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${
                        isCurrentProviderAuth ? "bg-success" : "bg-warning"
                      }`}
                    />
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
              )}

              {!isCurrentProviderAuth && (
                <button
                  type="button"
                  onClick={openSignIn}
                  className="focus-ring h-7 rounded-md bg-warning/10 px-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20 motion-reduce:transition-none"
                >
                  Sign in
                </button>
              )}

              {availableModels.length > 0 && (
                <Select
                  value={currentModel}
                  onValueChange={handleModelChange}
                  disabled={isWorking || !online}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Model"
                    className={`${CHIP_TRIGGER} max-w-56`}
                  >
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
              )}

              {supportsEffort && (
                <Select
                  value={currentEffort}
                  onValueChange={handleEffortChange}
                  disabled={isWorking || !online}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Effort"
                    className={CHIP_TRIGGER}
                  >
                    <SelectValue placeholder="Effort" />
                  </SelectTrigger>
                  <SelectContent>
                    {effortChoices.map((e) => (
                      <SelectItem
                        key={e.value}
                        value={e.value}
                        className="text-xs"
                      >
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <span className="flex-1" />

              <button
                type="submit"
                aria-label="Send message"
                disabled={!canSend}
                className="focus-ring flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0 motion-reduce:transition-none"
              >
                <ArrowUp strokeWidth={2} className="size-4" />
              </button>
            </div>
          </div>

          <p
            role="status"
            className={`mt-2 px-1 text-xs ${
              hint.tone === "warning"
                ? "text-warning"
                : "text-subtle-foreground"
            }`}
          >
            {hint.text}
          </p>
        </div>
      </form>
    </main>
  );
}
