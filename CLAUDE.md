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

**The backend uses `bun --watch`, not `bun --hot`.** `--watch` restarts the whole process on any change to `index.ts`, `User.ts`, `UserManager.ts`, `server.ts`, `config.ts`, or the `commons`/`db` packages (they are symlinked raw `.ts`, so edits there restart it too). `--hot` would re-evaluate the module in place and re-run `startServer` against a port the same process still holds; `startServer` now rejects that with a typed `ServerStartError` instead of the unhandled `EADDRINUSE` the old inline `new WebSocketServer({port: 3000})` produced, but the process still exits rather than serving. Preserving the server across hot reloads would mean stashing it on `globalThis`, which is not worth it while the connection handler is three lines.

A restart drops every open socket, and `useSocket` has no reconnect — so after the backend reloads, the browser needs a refresh. An in-flight agent run also dies with the process; the user message is already persisted (see "Persist before sending"), the assistant reply is not.

The backend requires `apps/backend/.env` with `DB_URL=<mongodb connection string>` (see `.env.example`). `mongoose.connect` runs in `index.ts` after config is resolved — if it rejects, the WebSocket server is never created and the process exits non-zero with the error logged.

### Runtime config

The backend and the frontend server used to have their addresses hardcoded (`ws://localhost:3000`, port `3000`, port `3001`). They're now resolved from environment variables, each with a pure resolver function so the rules are unit-tested without starting a process:

- **Backend** (`apps/backend/config.ts`, `resolveServerConfig`): `AGGCODE_HOST` (default `127.0.0.1`. There is no auth yet, so any other value is allowed but logs a warning that the agent is reachable from other machines) and `AGGCODE_PORT` (default `3000`; `0` asks the OS for any free port). `apps/backend/server.ts`'s `startServer({host, port, onConnection})` binds and resolves `{port, close}` once actually listening, or rejects with a typed `ServerStartError` (`kind: "in-use" | "denied" | "other"`) — `index.ts` turns that into a logged message and a non-zero exit, never a silent hang.
- **Frontend server** (`apps/frontend/src/serverConfig.ts`): `buildSocketConfig(env)` returns `{wsUrl}` for the `/api/config` route the browser fetches — `AGGCODE_BACKEND_URL` (a full `ws://`/`wss://` URL) wins outright if set, else it's built from `AGGCODE_PORT` (default `3000`; `0` is rejected here, since this process has no way to know which port the backend's OS actually picked). `resolveWebPort(env)` reads `AGGCODE_WEB_PORT` (default `3001`) for the frontend server's own port.
- **Browser** (`apps/frontend/src/lib/socketConfig.ts`): `loadSocketConfig()` prefers `window.__AGGCODE_CONFIG__` (set by Electron's preload script once that exists) and only falls back to fetching `/api/config` when it's absent; either path is validated with `parseSocketConfig` before `useSocket` trusts it. Any failure — network error, non-200, non-JSON, wrong shape — leaves `useSocket` in `closed` rather than stuck `connecting`.

The default is always `127.0.0.1`, never `localhost`: on Windows, `localhost` can resolve to `::1` first, and the server only binds the IPv4 loopback address.

Tests use `bun test` (no extra dependency). A package joins `bun run test` by adding `"test": "bun test"` to its `package.json`; the turbo `test` task picks it up. All three packages that have logic are in: `packages/commons` (the zod wire schemas, `config.ts`'s `parsePort`), `apps/backend` (`providers/*.test.ts`, `config.test.ts`, `server.test.ts`) and `apps/frontend` (`src/lib/*.test.ts`, `src/serverConfig.test.ts`). `User.ts` itself is still untested because it needs Mongo, so logic worth testing is pulled out into pure functions first (`providers/authScope.ts`, `lib/composer.ts`, `config.ts`) and the handler just calls them. `providers/index.test.ts` mocks `child_process` with `mock.module`; spread the real module into the mock or unrelated imports that need `execFile` fail to load.

## Workflow

One main system, plus three project skills in `.claude/skills/` (`before-and-after`, `unslop`, `sync`, pinned in `skills-lock.json`). For anything under ~30 minutes that touches ≤ 3 files, skip to step 2.

1. **Spec** — `/spartan:spec`. Write the acceptance criteria as numbered lines (`AC-1`, `AC-2`, …). The same numbers carry through: each AC gets a test in step 2, a check in step 4, and a line in the PR body.
2. **Build, test first** — `bun test` next to the code (`foo.ts` → `foo.test.ts`). If a wire message changes, a schema test in `packages/commons` comes first, because the four-place rule under "The wire protocol" is where changes break.
3. **Prove UI changes** — `before-and-after`. Capture the "before" image _before_ you edit, since both apps default to fixed ports (`:3000`, `:3001`, overridable with `AGGCODE_PORT` / `AGGCODE_WEB_PORT`, see "Runtime config" below) and normally aren't run twice side by side. Then pass the two image paths. **Do not use the default upload**: it posts to 0x0.st, which is public. Keep the images local or use `IMAGE_ADAPTER=gist`.
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

- `incoming.ts` — zod schemas + `IncomingMessageType`, a discriminated union on `type`: `create-workspace`, `create-session`, `add-message`, `update-session-config`, `delete-workspace`, `delete-session`, `provider-login`, `provider-logout`, `get-provider-auth`.
- `outgoing.ts` — `OutgoingMessageType`: `workspace-created`, `session-created`, `message-added`, `init`, `session-config-updated`, the `assistant-*` run frames, `workspace-deleted`, `session-deleted`, and the provider-auth frames `provider-auth-updated`, `provider-auth-result`, `provider-catalog-updated`. Also the domain types `Workspace`, `Session`, `Message` and the auth types `ProviderAuthStatus` / `ProviderDescriptor` shared by both sides.

Adding or changing a message means touching **four** places: the schema/union in `commons`, the `if (msg.type === ...)` chain in `apps/backend/User.ts`, the `socket.onmessage` handler in `apps/frontend/src/context/AppContext.tsx`, and the mongoose schema in `packages/db/index.ts` if it persists.

### Workspace-scoped subpath imports

Internal packages expose **only** a subpath, not the package root. Importing the bare package name will fail:

```ts
import type { Workspace } from "commons/types"; // packages/commons -> exports "./types"
import { SessionModel, WorkspaceModel } from "db/client"; // packages/db -> exports "./client"
```

Dependencies are declared as `"commons": "*"` / `"db": "*"` in each consuming `package.json`.

### Backend (`apps/backend`)

- `index.ts` — resolves the server config, connects mongoose, then calls `startServer` (`server.ts`). A bad `AGGCODE_PORT` or a port already in use exits the process with a message instead of connecting Mongo first or hanging silently. See "Runtime config" below.
- `UserManager.ts` — singleton (`getInstance()`) holding the connected `User[]`. On connect it assigns a uuid, wires `message`/`close`, **then** sends the `init` snapshot (all workspaces with their sessions nested, joined in memory by comparing `ObjectId.toString()`), and removes the user on close. Listeners go on before the snapshot query so nothing sent during it is dropped. All incoming-message errors are caught and logged here, never sent back to the client.
- `User.ts` — one instance per socket. `handleIncomingMessage` validates with the zod schema for that `type`, does the mongo write, and **returns** the outgoing message; `UserManager` sends it. Throws on unknown type or failed validation.

There is no auth, no user identity beyond the per-connection uuid, and no broadcast — every reply goes only to the originating socket.

### Frontend (`apps/frontend`)

Not Next.js. `src/index.ts` is a `Bun.serve` that serves `src/index.html` for `/*` (HTML imports are bundled by Bun; `frontend.tsx` mounts React 19 with `import.meta.hot` root reuse). `build.ts` produces a static `dist/` via `Bun.build` over `src/**/*.html`.

- `hooks/useSocket.ts` — resolves the backend URL via `lib/socketConfig.ts`'s `loadSocketConfig()` before opening the socket (window `__AGGCODE_CONFIG__` first, else a fetch to `/api/config`), then connects. Returns `{socket, status, loading}` and does not auto-reconnect: a dropped connection needs a page reload. See "Runtime config" below.
- `context/AppContext.tsx` — owns all state (`workspaces`, `activeSessionId`, `openWorkspaceId`, run state, provider auth) and the single `socket.onmessage` switch, and provides it through `useApp()`. `App.tsx` only lays out the components. Components send through the `send(socket, message)` helper in `lib/helpers.ts`, which is typed to `IncomingMessageType`, no-ops unless the socket is `OPEN`, and returns whether it sent.
- Tailwind v4 through `bun-plugin-tailwind` (wired in `bunfig.toml` for dev and `build.ts` for prod). **There is no `tailwind.config`** — theme lives in CSS (`src/index.css`, `styles/globals.css`).
- shadcn/ui, `new-york` style, `neutral` base, lucide icons (`components.json`). Components land in `src/components/ui/`. Path alias `@/*` → `./src/*`.
- The `/api/hello` template routes were removed from `src/index.ts`. Besides the `/*` catch-all, its only route is `/api/config`.

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

## Provider sign-in (apps/backend/providers)

Each provider may carry an `auth` plugin (`AuthProviderPlugin` in `types.ts`): its sign-in methods, a status check, `login` and `logout`. The modal in `ProviderAuthModal.tsx` renders whatever the descriptors list, so an advertised method must actually work end to end. A `free_tier` method that `login` rejected once shipped this way.

- **Sign-out never touches machine-wide logins.** The `claude` CLI login and OpenCode's `auth.json` are shared with every other tool on the machine. Claude sign-out only deletes the API key Aggcode stored and tells the user how to end the CLI login themselves. OpenCode sign-out only removes sub-providers Aggcode connected (recorded in `ProviderConfigModel` under `providerId: "opencode"`), through the SDK v2 `auth.remove`, never by editing `auth.json`. The first version ran `claude auth logout` and emptied `auth.json`.
- **Auth actions use `findProvider`, not `getProvider`.** `getProvider` falls back to Claude for routing chat, so a login or logout with a mistyped id would silently act on Claude.
- **The chat gate fails closed** (`chatGateRejection`): if the status check throws, the run does not start.
- **Status comes from one snapshot.** `getAuthSnapshot` checks every provider once, in parallel, for both the status map and the descriptors. The Claude CLI check (`claude auth status`, about 2s, much slower while OpenCode's server starts) shares one in-flight call, has a 15s timeout, and caches only signed-in results for 30s, so finishing a browser login shows up on the next check. A 4s timeout used to report a signed-in user as signed out right after backend start.
- **Stored API keys are encrypted** with AES-256-GCM (`credentialCipher.ts`, values prefixed `enc:v1:`). The key is `AGGCODE_CREDENTIALS_KEY` (32 bytes, base64) or `~/.aggcode/credentials.key`, created on first use. Values without the prefix are legacy plaintext and still read. Losing the key only means re-entering the API key.
- **Claude model ids are verified, not guessed.** `CLAUDE_CATALOG` in `providers/index.ts` lists ids confirmed with a real SDK run; `claude-3-7-sonnet` and `claude-3-5-*` were rejected as unknown models. `resolveModel` swaps an off-catalog id saved on an old session for the default, and `ChatPane` shows the default for it too.
- **A login or logout that throws is reported** as a failed `provider-auth-result`, and the client times the request out after 30s, so the modal spinner cannot hang.

## UI conventions (apps/frontend/src)

**`apps/frontend/DESIGN.md` is the design system** (tokens, type scale, shape, component recipes, copy rules, review checklist). Read it before any UI change.

`App.tsx` is now only the layout: it picks `ConnectingShell` while loading, then renders `Sidebar`, `ChatPane` and `ProviderAuthModal`. Each piece has its own file in `src/components/` (plus `AssistantTurn`, `ToolRow`, `RunIndicator`, `Elapsed`, `ToolIcon`, `ConfirmModal`). All state lives in `context/AppContext.tsx`, pure helpers in `lib/`. Add a component file when a piece has its own state or is reused; keep one-off markup in the component that renders it.

- **Dark mode is locked**, not toggled: `class="dark"` sits on `<html>` in `src/index.html` alongside `<meta name="color-scheme" content="dark">`. There is no light palette in use and no theme switcher.
- **Only semantic tokens.** Use `bg-background`, `bg-card`, `bg-muted`, `bg-primary`/`text-primary-foreground`, `bg-accent`/`text-accent-foreground`, `text-muted-foreground`, `border-border`, `border-input`, `ring-ring`, and for status `success` / `warning` (`bg-success/10 text-success`), plus `text-subtle-foreground` for tertiary text and `border-border-strong` for the composer and dialogs. Never raw palette classes like `bg-zinc-900`, or the page drifts off the shadcn token set in `styles/globals.css`.
- **Shape rule:** interactive controls are `rounded-md`, panels and message bubbles are `rounded-lg`, the composer shell and dialogs are `rounded-xl`, badges `rounded-sm`. `rounded-full` is for dots only.
- **Focus:** every interactive element uses the `focus-ring` utility from `globals.css`, not a hand-written `focus-visible:ring-*` string.
- **Custom text sizes** (`text-micro`, `text-ui`, `text-title`, `text-display`) must be registered in `lib/utils.ts`, or `cn()`'s tailwind-merge treats them as colours and drops them. That shipped once: every primitive lost its size.
- **Icons:** lucide-react only, `strokeWidth={1.5}` via the `ICON_STROKE` constant.
- **Motion:** colour transitions and one chevron rotation, all with a `motion-reduce:transition-none` companion. No animation library.
- The shell is `h-dvh` with `min-h-0 flex-1 overflow-y-auto` on the two scroll panes, so the sidebar and the transcript scroll independently instead of the page growing.
- Every list has a real empty state, and `status !== "open"` disables both composers and shows why.
- **Markdown comes from Streamdown**, not `react-markdown`: it tolerates the unterminated chunks that token-level streaming produces. It needs three things wired together, and silently renders unstyled if any is missing: the `streamdown` dep, `import "streamdown/styles.css"` in `App.tsx`, and the `@source "../node_modules/streamdown/dist/*.js"` directive in `styles/globals.css` so Tailwind scans its bundle for utility classes. It reuses the shadcn CSS custom properties already defined there.
- **Assistant turns are unbubbled and full column width** (`AssistantTurn` / `partsOf`); only user turns keep a bubble. A coding transcript is mostly code, and a bubble plus an 80% cap fights that. The column is `max-w-3xl` with `gap-6` between turns, spacing rather than borders doing the separating.
- **Prose measure is handled in CSS, not Tailwind:** `.transcript-prose :where(p, ul, ol, h1-h6, blockquote) { max-width: 70ch }` in `globals.css`. This is deliberately asymmetric — text stays readable while `pre` and `table` use the full width. Streamdown renders prose and code in one tree, so capping the container would cap code too.
- **Tool rows are accordions** (`ToolRow`), collapsed by default but auto-expanded while `status === "running"` and auto-collapsed once settled. The pattern is `override ?? part.status === "running"` with `override` as per-row local state, so an explicit click wins from then on. Keyed by React position, not `toolId`, because legacy rows all share an empty id.
- **`RunIndicator` reports real state,** not a generic label: the running tool if there is one, else the live thinking-token count, plus elapsed seconds. `Elapsed` is its own component so only it re-renders each second. Deliberately no rotating verb and no "esc to interrupt" hint: `Query.interrupt()` only works in streaming-input mode, which this does not use, so the hint would be a lie.
- **Never re-wrap a `Message` from the wire.** The server sends a complete `{role, payload:{message}}`; append it through `appendMessage()`. Wrapping it a second time makes `payload.message` an object, and `ChatPane` renders it as a React child, which throws and unmounts the whole tree. An `as any` at the append site is what let that ship, so no casts there.
- **Run state is per session, never global**: `workingSessionIds` and `sessionErrors` are keyed by session id because the sidebar lets you switch sessions while a run is in flight. `ChatPane` reads its own session's entry, and the composer is disabled for that session only.
- The working indicator and error row are extra `<li>`s inside the same `<ol>`, so they must be in the auto-scroll effect's dependencies or they render below the fold.
- Losing the socket clears every working indicator, since no terminal frame can arrive. The run does continue server side and its reply reaches Mongo, so it reappears on reload. `useSocket` has no reconnect, so live delivery after a drop is genuinely lossy.

## Note on the global rules

The user-level `CLAUDE.md` and `rules/` are written for a Kotlin/Micronaut + Exposed/PostgreSQL stack (controllers/managers/repositories, `@Post("/list")`, Either error handling). Those specifics do not apply to this TypeScript/Bun/MongoDB repo. The general principles (spec before code, no workarounds, no silent catch, match the user's language) still do.
