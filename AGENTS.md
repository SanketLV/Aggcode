# AGENTS.md

Bun + Turborepo monorepo. WebSocket-only app (no REST). MongoDB backend, React frontend.

## Commands

```sh
bun install                          # install all workspaces
bun run dev                          # backend :3000 + frontend :3001
bun run build                        # production frontend build
bun run test                         # bun test, via turbo
bun run format                       # prettier
```

Tests use `bun test`, next to the code (`foo.ts` → `foo.test.ts`). `packages/commons`, `apps/backend` and `apps/frontend` all have tests. `User.ts` needs Mongo, so testable logic goes in pure functions it calls (`apps/backend/providers/authScope.ts`, `apps/frontend/src/lib/composer.ts`). A package joins `bun run test` by adding `"test": "bun test"` to its scripts. No lint or typecheck tasks are wired up (they exist in turbo.json but both apps have no-op scripts).

## Workflow

spec (numbered acceptance criteria) → test-first build → `before-and-after` for UI changes (capture "before" before editing; never the default public 0x0.st upload) → `bun run test` + `bun run build` + review → `unslop` on commit/PR prose → PR into `dev` → `/sync`. Full version in `CLAUDE.md` under "Workflow".

## Package manager

**Bun only.** Never npm/yarn/pnpm. `devEngines.packageManager: bun@1.4.0`.

## Subpath imports

Packages expose only a subpath, not the package root:

```ts
import type { Workspace } from "commons/types"; // NOT "commons"
import { SessionModel, WorkspaceModel } from "db/client"; // NOT "db"
```

## Backend watch mode

Uses `bun --watch`, **not** `bun --hot`. `--hot` re-evaluates in place and re-binds the port → `startServer` (`server.ts`) rejects with a typed `ServerStartError`, exiting the process rather than the old silent `EADDRINUSE`. After any backend file changes, the browser must be refreshed (`useSocket` has no reconnect).

## Environment

Backend needs `apps/backend/.env` with `DB_URL=<mongodb connection string>`. If it is missing, mongoose.connect rejects and the process exits non-zero, logged. Optional `AGGCODE_HOST` (default `127.0.0.1`, loopback only) and `AGGCODE_PORT` (default `3000`, `0` = any free port) resolve via `config.ts`; the frontend server reads its own backend URL from `AGGCODE_BACKEND_URL` / `AGGCODE_PORT` (`apps/frontend/src/serverConfig.ts`) and serves it to the browser at `/api/config`. Details in `CLAUDE.md` under "Runtime config".

Optional `AGGCODE_CREDENTIALS_KEY` (32 bytes, base64) encrypts API keys stored in Mongo. Unset, a key is created at `~/.aggcode/credentials.key`; losing it only means entering the API key again.

## Provider sign-in

Sign-out must never end machine-wide logins: no `claude auth logout`, no editing OpenCode's `auth.json`. It only removes what Aggcode itself stored or connected. Auth actions look providers up with `findProvider`, never `getProvider` (that one falls back to Claude). Details in `CLAUDE.md` under "Provider sign-in".

## Adding or changing a message type

Four places to update: `packages/commons/incoming.ts` (schema), `apps/backend/User.ts` (handler), `apps/frontend/src/context/AppContext.tsx` (onmessage), `packages/db/index.ts` (mongoose schema if it persists).

## Dead scaffolding

`packages/ui`, `packages/eslint-config`, `packages/typescript-config` are starter leftovers. Nothing depends on them. Both apps have standalone tsconfig.json.

## Frontend specifics

- **No `tailwind.config`** — theme lives in `styles/globals.css` (Tailwind v4).
- **Markdown rendering** uses `streamdown`, not `react-markdown`. It needs all three: the dep, `import "streamdown/styles.css"` in App.tsx, and `@source "../node_modules/streamdown/dist/*.js"` in globals.css.
- Dark mode is locked on (`class="dark"` on `<html>`). No light palette, no toggle.
- Design system: build all UI to `apps/frontend/DESIGN.md`; token values live in `styles/globals.css`. The canvas source in `apps/frontend/design/` stays outside `src/`, because `build.ts` bundles every `src/**/*.html`.
- Semantic tokens only (`bg-background`, `bg-card`, etc; `success` / `warning` for status). No raw palette classes.
- Focus styles use the `focus-ring` utility from `globals.css`, never a hand written `focus-visible:ring-*` string.
- Custom text sizes (`text-micro`, `text-ui`, `text-title`, `text-display`) must be registered in `src/lib/utils.ts`, or `cn()` reads them as colours and drops them.
- shadcn/ui `new-york` style, `neutral` base, lucide icons. Components in `src/components/ui/`.
- Frontend uses `--hot` for HMR (unlike backend which uses `--watch`).

## Refer to

`CLAUDE.md` for full architecture, message flow, streaming details, and UI conventions.
