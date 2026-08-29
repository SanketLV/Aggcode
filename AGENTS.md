# AGENTS.md

Bun + Turborepo monorepo. WebSocket-only app (no REST). MongoDB backend, React frontend.

## Commands

```sh
bun install                          # install all workspaces
bun run dev                          # backend :3000 + frontend :3001
bun run build                        # production frontend build
bun run format                       # prettier
```

No test runner is configured. No lint or typecheck tasks are wired up (they exist in turbo.json but both apps have no-op scripts).

## Package manager

**Bun only.** Never npm/yarn/pnpm. `devEngines.packageManager: bun@1.4.0`.

## Subpath imports

Packages expose only a subpath, not the package root:

```ts
import type { Workspace } from "commons/types"; // NOT "commons"
import { SessionModel, WorkspaceModel } from "db/client"; // NOT "db"
```

## Backend watch mode

Uses `bun --watch`, **not** `bun --hot`. `--hot` re-evaluates in place and re-binds port 3000 → `EADDRINUSE` → silent failure. After any backend file changes, the browser must be refreshed (`useSocket` has no reconnect).

## Environment

Backend needs `apps/backend/.env` with `DB_URL=<mongodb connection string>`. If it is missing, mongoose.connect rejects and the WebSocket server is never created — no visible error beyond a console log.

## Adding or changing a message type

Four places to update: `packages/commons/incoming.ts` (schema), `apps/backend/User.ts` (handler), `apps/frontend/src/App.tsx` (onmessage), `packages/db/index.ts` (mongoose schema if it persists).

## Dead scaffolding

`packages/ui`, `packages/eslint-config`, `packages/typescript-config` are starter leftovers. Nothing depends on them. Both apps have standalone tsconfig.json.

## Frontend specifics

- **No `tailwind.config`** — theme lives in `styles/globals.css` (Tailwind v4).
- **Markdown rendering** uses `streamdown`, not `react-markdown`. It needs all three: the dep, `import "streamdown/styles.css"` in App.tsx, and `@source "../node_modules/streamdown/dist/*.js"` in globals.css.
- Dark mode is locked on (`class="dark"` on `<html>`). No light palette, no toggle.
- Semantic tokens only (`bg-background`, `bg-card`, etc). No raw palette classes.
- shadcn/ui `new-york` style, `neutral` base, lucide icons. Components in `src/components/ui/`.
- Frontend uses `--hot` for HMR (unlike backend which uses `--watch`).

## Refer to

`CLAUDE.md` for full architecture, message flow, streaming details, and UI conventions.
