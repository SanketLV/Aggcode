import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, MessageSquare } from "lucide-react";
import { ICON_STROKE } from "../constants";
import { useApp } from "../context/AppContext";
import { send, partsOf } from "../lib/helpers";
import type { ToolPart } from "../types";
import { AssistantTurn } from "./AssistantTurn";
import { RunIndicator } from "./RunIndicator";

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

  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed === "" || !online || isWorking) {
      return;
    }

    const sent = send(socket, {
      type: "add-message",
      payload: { sessionId: active.session.id, message: trimmed },
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
        <div className="mx-auto flex max-w-4xl items-end gap-2">
          <label htmlFor="composer" className="sr-only">
            Message
          </label>
          <textarea
            id="composer"
            rows={1}
            value={draft}
            disabled={isWorking}
            placeholder={isWorking ? "Waiting for the agent" : "Send a message"}
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
            disabled={!online || isWorking || draft.trim() === ""}
            className="rounded-md bg-primary p-2 text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:translate-y-px disabled:opacity-50 motion-reduce:transition-none"
          >
            <ArrowUp strokeWidth={ICON_STROKE} className="size-4" />
          </button>
        </div>
        {!online ? (
          <p className="mx-auto mt-2 max-w-4xl text-xs text-muted-foreground">
            Disconnected from the server, so messages cannot be saved.
          </p>
        ) : isWorking ? (
          <p className="mx-auto mt-2 max-w-4xl text-xs text-muted-foreground">
            The agent is still working on this session. One turn at a time.
          </p>
        ) : null}
      </form>
    </main>
  );
}
