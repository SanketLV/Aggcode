# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Aggcode is an early-stage WebSocket app for managing coding **workspaces** (a filesystem path) and **sessions** (a conversation attached to a workspace). It is a Bun + Turborepo monorepo. There is no HTTP/REST API — all client/server traffic goes over a single WebSocket.

> `README.md` at the root is the untouched `create-turbo` starter README. It describes `docs`/`web` Next.js apps that do not exist here. Ignore it.

## Runtime and package manager

Everything runs on **Bun** (`devEngines.packageManager: bun@1.4.0`), including TypeScript directly — there is no compile step for the backend or the shared packages (`noEmit: true` everywhere; packages are consumed as raw `.ts` via workspace `exports`). Use `bun install`, `bun run`, `bunx` — not npm/yarn/pnpm.

## Commands

Root (Turborepo):

```sh
bun install                 # install all workspaces
bun run dev                 # turbo run dev  -> backend (:3000) + frontend (:3001), both auto-reloading
bun run build               # turbo run build
bun run lint                # turbo run lint (currently a no-op for both apps)
bun run check-types         # turbo run check-types (currently a no-op for both apps)
bun run test                # turbo run test -> bun test in every package with a test script
bun run format              # prettier --write "**/*.{ts,tsx,md}"
```

Either app can also be run on its own:

```sh
cd apps/backend && bun run dev            # bun --watch index.ts, WebSocket server on :3000
cd apps/frontend && bun run dev           # Bun.serve + React HMR on :3001
```

**The backend uses `bun --watch`, not `bun --hot`.** `--watch` restarts the whole process on any change to `index.ts`, `User.ts`, `UserManager.ts`, or the `commons`/`db` packages (they are symlinked raw `.ts`, so edits there restart it too). `--hot` would re-evaluate the module in place and re-run `new WebSocketServer({port: 3000})` against a port the same process still holds, so the second bind emits an unhandled `EADDRINUSE` and the server silently stops accepting connections. Preserving the server across hot reloads would mean stashing it on `globalThis`, which is not worth it while the connection handler is three lines.

A restart drops every open socket, and `useSocket` has no reconnect — so after the backend reloads, the browser needs a refresh. An in-flight agent run also dies with the process; the user message is already persisted (see "Persist before sending"), the assistant reply is not.

The backend requires `apps/backend/.env` with `DB_URL=<mongodb connection string>` (see `.env.example`). `mongoose.connect` is the outer promise in `index.ts` — if it rejects, the WebSocket server is never created and the only output is a logged error.

Tests use `bun test` (no extra dependency). Only `packages/commons` has tests so far (`incoming.test.ts`, the zod wire schemas). A package joins `bun run test` by adding `"test": "bun test"` to its `package.json`; the turbo `test` task picks it up. The backend and frontend have none yet: `User.ts` needs Mongo, so testing it means either a test database or pulling the handlers away from the models first.

## Workflow

One main system, plus three project skills in `.claude/skills/` (`before-and-after`, `unslop`, `sync`, pinned in `skills-lock.json`). For anything under ~30 minutes that touches ≤ 3 files, skip to step 2.

1. **Spec** — `/spartan:spec`. Write the acceptance criteria as numbered lines (`AC-1`, `AC-2`, …). The same numbers carry through: each AC gets a test in step 2, a check in step 4, and a line in the PR body.
2. **Build, test first** — `bun test` next to the code (`foo.ts` → `foo.test.ts`). If a wire message changes, a schema test in `packages/commons` comes first, because the four-place rule under "The wire protocol" is where changes break.
3. **Prove UI changes** — `before-and-after`. Capture the "before" image *before* you edit, since both apps use hardcoded ports (`:3000`, `:3001`) and cannot run twice side by side. Then pass the two image paths. **Do not use the default upload**: it posts to 0x0.st, which is public. Keep the images local or use `IMAGE_ADAPTER=gist`.
4. **Check** — `bun run test`, `bun run build`, then `/code-review`. Go through the ACs one by one against the running app, not the diff.
5. **Ship** — run `unslop` over the commit message and PR body, then `/spartan:pr-ready`. Feature branches come off `dev`; `main` is production.
6. **Sync** — `/sync` after merge. It only maintains `AGENTS.md` (it treats `CLAUDE.md` as a pointer and never writes into it), so bring this file up to date by hand in the same change. Most of the durable rules live here.

## Architecture

```
apps/frontend (Bun.serve :3001)  ──WebSocket──▶  apps/backend (ws :3000)  ──▶  MongoDB
        │                                               │
        └──────────── packages/commons ─────────────────┘        packages/db
                      (wire protocol)                            (mongoose models)
```

### The wire protocol is the central contract

`packages/commons` is the single source of truth for every message crossing the socket:

- `incoming.ts` — zod schemas + `IncomingMessageType`, a discriminated union on `type`: `create-workspace`, `create-session`, `add-message`.
- `outgoing.ts` — `OutgoingMessageType`: `workspace-created`, `session-created`, `message-added`, `init`. Also the domain types `Workspace`, `Session`, `Message` shared by both sides.

Adding or changing a message means touching **four** places: the schema/union in `commons`, the `if (msg.type === ...)` chain in `apps/backend/User.ts`, the `socket.onmessage` handler in `apps/frontend/src/App.tsx`, and the mongoose schema in `packages/db/index.ts` if it persists.

### Workspace-scoped subpath imports

Internal packages expose **only** a subpath, not the package root. Importing the bare package name will fail:

```ts
import type { Workspace } from "commons/types"; // packages/commons -> exports "./types"
import { SessionModel, WorkspaceModel } from "db/client"; // packages/db -> exports "./client"
```

Dependencies are declared as `"commons": "*"` / `"db": "*"` in each consuming `package.json`.

### Backend (`apps/backend`)

- `index.ts` — connects mongoose, then opens a bare `ws` `WebSocketServer` on port 3000.
- `UserManager.ts` — singleton (`getInstance()`) holding the connected `User[]`. On connect it assigns a uuid, wires `message`/`close`, **then** sends the `init` snapshot (all workspaces with their sessions nested, joined in memory by comparing `ObjectId.toString()`), and removes the user on close. Listeners go on before the snapshot query so nothing sent during it is dropped. All incoming-message errors are caught and logged here, never sent back to the client.
- `User.ts` — one instance per socket. `handleIncomingMessage` validates with the zod schema for that `type`, does the mongo write, and **returns** the outgoing message; `UserManager` sends it. Throws on unknown type or failed validation.

There is no auth, no user identity beyond the per-connection uuid, and no broadcast — every reply goes only to the originating socket.

### Frontend (`apps/frontend`)

Not Next.js. `src/index.ts` is a `Bun.serve` that serves `src/index.html` for `/*` (HTML imports are bundled by Bun; `frontend.tsx` mounts React 19 with `import.meta.hot` root reuse). `build.ts` produces a static `dist/` via `Bun.build` over `src/**/*.html`.

- `hooks/useSocket.ts` — opens `ws://localhost:3000`. **The URL is hardcoded**; there is no env config for it. Returns `{socket, status, loading}` and does not auto-reconnect: a dropped connection needs a page reload.
- `App.tsx` — owns all state (`workspaces`, `activeSessionId`, `openWorkspaceId`) and the single `onmessage` switch, then provides it through `context/AppContext.tsx`. Child components send through the module-level `send(socket, message)` helper, which is typed to `IncomingMessageType` and no-ops unless the socket is `OPEN`.
- Tailwind v4 through `bun-plugin-tailwind` (wired in `bunfig.toml` for dev and `build.ts` for prod). **There is no `tailwind.config`** — theme lives in CSS (`src/index.css`, `styles/globals.css`).
- shadcn/ui, `new-york` style, `neutral` base, lucide icons (`components.json`). Components land in `src/components/ui/`. Path alias `@/*` → `./src/*`.
- `/api/hello` routes in `src/index.ts` are leftover template scaffolding, unused.

### Dead scaffolding from `create-turbo`

`packages/ui`, `packages/eslint-config`, and `packages/typescript-config` are starter leftovers — **nothing in `apps/` depends on them**. Both apps carry their own standalone `tsconfig.json` (Bun-style: `moduleResolution: bundler`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`) rather than extending `@repo/typescript-config`, and neither has an ESLint config. Don't assume changes to those packages affect anything; if a shared component or config is genuinely wanted, wire the dependency up first.

## Message flow, end to end

`add-message` runs the agent through `@anthropic-ai/claude-agent-sdk`, so **one incoming message can produce several outgoing messages over time**. `handleIncomingMessage` therefore returns `OutgoingMessageType | null`, and `null` means "this branch already sent its own frames" (`UserManager` guards with `if (responsePayload)`).

| Client sends                        | Server does                                                                    | Server replies                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-workspace` `{path}`         | derives `name` from the last path segment (splits on `/` **and** `\`), inserts | `workspace-created` `{id,name,path}`                                                                                                                       |
| `create-session` `{workspaceId}`    | verifies the workspace exists, inserts a session with `messages: []`           | `session-created` `{id,workspaceId}`                                                                                                                       |
| `add-message` `{sessionId,message}` | persists the user row, echoes it, then runs one agent turn                     | `message-added`, `assistant-working`, then any number of `assistant-delta` / `assistant-tool`, then exactly one of `assistant-message` / `assistant-error` |

**The run invariant:** every `assistant-working` is followed by exactly one `assistant-message` or `assistant-error` for the same `sessionId`. The client clears its working indicator only on those terminal frames, so `runAgent` guarantees one via an idempotent `settle()` plus a `finally` backstop. Breaking that invariant hangs the UI with a spinner that never stops.

### Streaming and the transcript

An assistant turn is a `MessagePart[]` transcript, not a single string: `{type:"text",text}` blocks interleaved with `{type:"tool",name,detail}` entries, in the order they happened. `payload.message` remains the plain final answer, used for sidebar previews and for rows written before `parts` existed, so **render `parts` when present and fall back to `message`**.

The two SDK message kinds map to different frames, and mixing them up double-renders the reply:

- `stream_event` (needs `includePartialMessages: true`) carries raw Messages API deltas. Only `content_block_delta` with `delta.type === "text_delta"` is forwarded, as `assistant-delta`. This is what makes prose appear as it is written.
- `assistant` carries _completed_ content blocks. Its text is deliberately **skipped** (the deltas already sent it); only `tool_use` blocks are new information, forwarded as `assistant-tool`.
- `user` messages are emitted by the CLI for content it adds itself, chiefly the `tool_result` blocks answering each `tool_use`. These become `assistant-tool-result`.
- `system` / `subtype: "thinking_tokens"` carries a live thinking-token estimate. The SDK documents it as intended for progress indicators, not for billing.

`assistant-tool-result` is **the one frame that mutates an existing part** rather than appending; everything else is append-only. It matches on `toolId` (the API's `tool_use` block id), which is why tool parts carry one. `settle` also flips any part still `running` to `done`, since the turn ending means nothing can still be in flight.

Tool output is capped at 2000 characters before it is stored, or a single `Read` of a large file would bloat the session document.

**Tool-result parsing is defensive on purpose.** The SDK's declared peer `@anthropic-ai/sdk` is _not installed_, so its `MessageParam` import is unresolved and `skipLibCheck: true` hides that. Everything the backend reads out of `message.message.content` is effectively untyped, so `extractToolResults` / `toolResultText` narrow at runtime and never trust the compiler. Installing that peer would restore real types.

`runAgent` accumulates `parts` server-side and persists them once, at settle, so a reload matches what the user watched. `settle` also back-fills a text part from the final result if no delta ever arrived, so a run that only called tools still shows its answer.

Tool `detail` is relativized against the workspace `cwd`; a path _outside_ the workspace stays absolute on purpose, because that is a signal worth seeing.

**Adding a field to a stored message means editing `UserManager.sendInitialState` too.** It maps stored messages field by field, so anything it misses works perfectly live and then vanishes on reload. `parts` shipped broken this exact way once, and the flat mongo subdocument has to be narrowed back to the discriminated union there via `toMessageParts`.

Other rules that path depends on:

- **The user echo is emitted before `query()` is called.** Emitting it after the run (which is what the first agent integration did) both delayed it for the whole run and placed it _below_ the assistant reply.
- **Persist before sending, always.** A socket that dropped mid-run should cost the live update, never the data.
- **Failures are not persisted** as assistant rows: an error is not part of the conversation, and storing it would feed it back as context on the next `resume`. So a failed exchange legitimately reloads as a user message with no reply.
- **`cwd` must never fall back to `undefined`.** The agent runs with `permissionMode: "acceptEdits"` and `Edit` allowed, so an unresolved workspace path would point it at the backend's own directory, i.e. this repo. `add-message` hard-rejects instead.
- **One run per session at a time,** enforced by a process-wide `activeRuns` set in `User.ts` (so a second browser tab cannot bypass it). Concurrent runs would race on `anthropicSessionId` and interleave writes.
- **Rejections are reported, not thrown.** `UserManager`'s `catch` only logs, so anything thrown leaves the client with no explanation. Recoverable rejections send `assistant-error`.
- `session-created` and `message-added` deliberately echo back the owning `workspaceId` / `sessionId` so the client can place the result without tracking in-flight requests.

Two client-side conventions to keep:

- **Workspace creation is optimistic**, everything else is server-confirmed. A submitted workspace is held in local state as `{...w, pending: true}` with a `pending:<uuid>` placeholder id, then swapped for the real record when `workspace-created` arrives (matched on `path`). Sessions and messages are only appended on the server's reply, so what is on screen is what is in Mongo.
- **`useSocket` returns the socket synchronously, before the handshake resolves**, so `App` can attach `onmessage` in time for the `init` snapshot the server pushes on connect. Use the returned `status` (`connecting` / `open` / `closed`), not the socket's existence, to gate sends.

## UI conventions (apps/frontend/src/App.tsx)

Everything lives in `App.tsx` (`App` / `ConnectingShell` / `Sidebar` / `ChatPane`) by deliberate choice. Keep it that way until the file genuinely needs splitting.

- **Dark mode is locked**, not toggled: `class="dark"` sits on `<html>` in `src/index.html` alongside `<meta name="color-scheme" content="dark">`. There is no light palette in use and no theme switcher.
- **Only semantic tokens.** Use `bg-background`, `bg-card`, `bg-muted`, `bg-primary`/`text-primary-foreground`, `bg-accent`/`text-accent-foreground`, `text-muted-foreground`, `border-border`, `border-input`, `ring-ring`. Never raw palette classes like `bg-zinc-900`, or the page drifts off the shadcn token set in `styles/globals.css`.
- **Shape rule:** interactive controls are `rounded-md`, panels and message bubbles are `rounded-lg`.
- **Icons:** lucide-react only, `strokeWidth={1.5}` via the `ICON_STROKE` constant.
- **Motion:** colour transitions and one chevron rotation, all with a `motion-reduce:transition-none` companion. No animation library.
- The shell is `h-dvh` with `min-h-0 flex-1 overflow-y-auto` on the two scroll panes, so the sidebar and the transcript scroll independently instead of the page growing.
- Every list has a real empty state, and `status !== "open"` disables both composers and shows why.
- **Markdown comes from Streamdown**, not `react-markdown`: it tolerates the unterminated chunks that token-level streaming produces. It needs three things wired together, and silently renders unstyled if any is missing: the `streamdown` dep, `import "streamdown/styles.css"` in `App.tsx`, and the `@source "../node_modules/streamdown/dist/*.js"` directive in `styles/globals.css` so Tailwind scans its bundle for utility classes. It reuses the shadcn CSS custom properties already defined there.
- **Assistant turns are unbubbled and full column width** (`AssistantTurn` / `partsOf`); only user turns keep a bubble. A coding transcript is mostly code, and a bubble plus an 80% cap fights that. The column is `max-w-4xl` with `gap-6` between turns, spacing rather than borders doing the separating.
- **Prose measure is handled in CSS, not Tailwind:** `.transcript-prose :where(p, ul, ol, h1-h6, blockquote) { max-width: 70ch }` in `globals.css`. This is deliberately asymmetric — text stays readable while `pre` and `table` use the full width. Streamdown renders prose and code in one tree, so capping the container would cap code too.
- **Tool rows are accordions** (`ToolRow`), collapsed by default but auto-expanded while `status === "running"` and auto-collapsed once settled. The pattern is `override ?? part.status === "running"` with `override` as per-row local state, so an explicit click wins from then on. Keyed by React position, not `toolId`, because legacy rows all share an empty id.
- **`RunIndicator` reports real state,** not a generic label: the running tool if there is one, else the live thinking-token count, plus elapsed seconds. `Elapsed` is its own component so only it re-renders each second. Deliberately no rotating verb and no "esc to interrupt" hint: `Query.interrupt()` only works in streaming-input mode, which this does not use, so the hint would be a lie.
- **Never re-wrap a `Message` from the wire.** The server sends a complete `{role, payload:{message}}`; append it through `appendMessage()`. Wrapping it a second time makes `payload.message` an object, and `ChatPane` renders it as a React child, which throws and unmounts the whole tree. An `as any` at the append site is what let that ship, so no casts there.
- **Run state is per session, never global**: `workingSessionIds` and `sessionErrors` are keyed by session id because the sidebar lets you switch sessions while a run is in flight. `ChatPane` reads its own session's entry, and the composer is disabled for that session only.
- The working indicator and error row are extra `<li>`s inside the same `<ol>`, so they must be in the auto-scroll effect's dependencies or they render below the fold.
- Losing the socket clears every working indicator, since no terminal frame can arrive. The run does continue server side and its reply reaches Mongo, so it reappears on reload. `useSocket` has no reconnect, so live delivery after a drop is genuinely lossy.

## Note on the global rules

The user-level `CLAUDE.md` and `rules/` are written for a Kotlin/Micronaut + Exposed/PostgreSQL stack (controllers/managers/repositories, `@Post("/list")`, Either error handling). Those specifics do not apply to this TypeScript/Bun/MongoDB repo. The general principles (spec before code, no workarounds, no silent catch, match the user's language) still do.
