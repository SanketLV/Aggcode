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
bun run dev                 # turbo run dev  -> frontend only (see caveat)
bun run build               # turbo run build
bun run lint                # turbo run lint (currently a no-op for both apps)
bun run check-types         # turbo run check-types (currently a no-op for both apps)
bun run format              # prettier --write "**/*.{ts,tsx,md}"
```

**Caveat: `apps/backend/package.json` has no `scripts` block**, so `turbo run dev` does not start the backend. Run it directly:

```sh
cd apps/backend && bun --hot index.ts     # WebSocket server on :3000
cd apps/frontend && bun run dev           # Bun.serve + React HMR on :3001
```

The backend requires `apps/backend/.env` with `DB_URL=<mongodb connection string>` (see `.env.example`). `mongoose.connect` is the outer promise in `index.ts` — if it rejects, the WebSocket server is never created and the only output is a logged error.

There is **no test setup** in this repo (no test runner, no test files, no `test` task in `turbo.json`). If tests are wanted, `bun test` is the natural fit for a Bun repo.

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
import type { Workspace } from "commons/types";      // packages/commons -> exports "./types"
import { SessionModel, WorkspaceModel } from "db/client";  // packages/db -> exports "./client"
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

Only the user side of the conversation exists. There is no agent/assistant layer yet: `Message.role` allows `"assistant"`, but nothing ever writes one.

| Client sends | Server does | Server replies |
|---|---|---|
| `create-workspace` `{path}` | derives `name` from the last path segment (splits on `/` **and** `\`), inserts | `workspace-created` `{id,name,path}` |
| `create-session` `{workspaceId}` | verifies the workspace exists, inserts a session with `messages: []` | `session-created` `{id,workspaceId}` |
| `add-message` `{sessionId,message}` | `$push` onto `messages` via `findByIdAndUpdate` | `message-added` `{sessionId,message}` |

`session-created` and `message-added` deliberately echo back the owning `workspaceId` / `sessionId` so the client can place the result without tracking in-flight requests.

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
- The shell is `h-[100dvh]` with `min-h-0 flex-1 overflow-y-auto` on the two scroll panes, so the sidebar and the transcript scroll independently instead of the page growing.
- Every list has a real empty state, and `status !== "open"` disables both composers and shows why.

## Note on the global rules

The user-level `CLAUDE.md` and `rules/` are written for a Kotlin/Micronaut + Exposed/PostgreSQL stack (controllers/managers/repositories, `@Post("/list")`, Either error handling). Those specifics do not apply to this TypeScript/Bun/MongoDB repo. The general principles (spec before code, no workarounds, no silent catch, match the user's language) still do.
