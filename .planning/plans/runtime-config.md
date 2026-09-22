# Plan: Runtime config for the backend address

**Spec**: .planning/specs/runtime-config.md
**Epic**: desktop-app (feature 1 of 5)
**Created**: 2026-09-22
**Status**: draft
**Branch**: `feature/runtime-config` (off `dev`)

## Approach

Env parsing is pure and takes `env` as a parameter that defaults to `process.env`, the same pattern as `loadOrCreateKey` in `providers/credentialCipher.ts`. That keeps every rule testable without starting a process. Port parsing is needed by both the backend and the frontend server, so it lives once in `packages/commons` under a new `commons/config` subpath.

Startup order in `apps/backend/index.ts` becomes: resolve config (fail fast on bad input, before touching Mongo) → connect Mongo → `startServer` → log the real URL. A start failure exits non-zero with a message instead of today's silent unhandled `EADDRINUSE`.

On the frontend, `useSocket` resolves its URL through `loadSocketConfig()` before opening the socket. `AppContext` already guards `if (!socket)` and attaches `onmessage` when the socket appears, before `open`, so the `init` snapshot is still caught.

## Components

| Component                                | Type                            | Purpose                                                                                                                              |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `parsePort`                              | Pure function (commons)         | Validates a port string: empty means default, otherwise an integer 0–65535. Error names the variable and the value.                  |
| `resolveServerConfig`                    | Pure function (backend)         | `{host, port}` from `AGGCODE_HOST` / `AGGCODE_PORT`, defaults `127.0.0.1` / `3000`.                                                  |
| `isLoopbackHost`                         | Pure function (backend)         | Decides whether to warn that the agent is reachable from other machines.                                                             |
| `startServer`                            | Async function (backend)        | Binds a `WebSocketServer`, resolves `{port, close}` once listening, rejects with `ServerStartError` (`in-use` / `denied` / `other`). |
| `buildSocketConfig`                      | Pure function (frontend server) | `{wsUrl}` from `AGGCODE_BACKEND_URL`, else `AGGCODE_PORT`, else 3000. Rejects `AGGCODE_PORT=0`.                                      |
| `/api/config`                            | Bun.serve route                 | Serves `buildSocketConfig()` as JSON, no CORS headers.                                                                               |
| `parseSocketConfig` / `loadSocketConfig` | Browser helpers                 | Validate the config shape; prefer `window.__AGGCODE_CONFIG__`, else fetch `/api/config`. `fetch` is injectable for tests.            |
| `useSocket`                              | React hook                      | Loads config, then connects. `closed` on any config failure.                                                                         |

## New files

| File                   | Location                 | Purpose                                                                       |
| ---------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `config.ts`            | `packages/commons/`      | `parsePort`                                                                   |
| `config.test.ts`       | `packages/commons/`      | Port parsing tests                                                            |
| `config.ts`            | `apps/backend/`          | `resolveServerConfig`, `isLoopbackHost`                                       |
| `config.test.ts`       | `apps/backend/`          | Env resolution tests                                                          |
| `server.ts`            | `apps/backend/`          | `startServer`, `ServerStartError`                                             |
| `server.test.ts`       | `apps/backend/`          | Real bind on `127.0.0.1:0`, connect, close, port clash                        |
| `serverConfig.ts`      | `apps/frontend/src/`     | `buildSocketConfig` (server side only, imported by `index.ts`)                |
| `serverConfig.test.ts` | `apps/frontend/src/`     | URL precedence and the port-0 error                                           |
| `socketConfig.ts`      | `apps/frontend/src/lib/` | `parseSocketConfig`, `loadSocketConfig`, the `window.__AGGCODE_CONFIG__` type |
| `socketConfig.test.ts` | `apps/frontend/src/lib/` | Global wins, fetch path, every failure shape                                  |

## Files to change

| File                                   | What changes                                                                            | Why                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| `packages/commons/package.json`        | Add `"./config": "./config.ts"` to `exports`                                            | Packages expose subpaths only       |
| `apps/backend/index.ts`                | Config first, then Mongo, then `startServer`; exit codes; non-loopback warning          | AC-1, AC-3, AC-4, AC-5, edge case 6 |
| `apps/frontend/src/index.ts`           | Add `/api/config`, remove `/api/hello*`                                                 | AC-6                                |
| `apps/frontend/src/hooks/useSocket.ts` | URL from `loadSocketConfig()`; `closed` on failure; ignore results after unmount        | AC-7, AC-8                          |
| `apps/backend/.env.example`            | Document `AGGCODE_HOST`, `AGGCODE_PORT`                                                 | AC-10                               |
| `CLAUDE.md`                            | Replace the hardcoded-URL notes, the `index.ts` description, the port lines in Commands | AC-10                               |
| `AGENTS.md`                            | One line for the new env vars under Environment                                         | Keeps the short doc true            |

## Tasks

### Phase 1: Port parsing (shared)

| #   | Task                                                               | Files                                                          | Test first                                                                                                                                          |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `parsePort(value, name, fallback)` and the `commons/config` export | `packages/commons/config.ts`, `config.test.ts`, `package.json` | `""` → fallback; `"0"`, `"3000"`, `"65535"` pass; `"abc"`, `"3000.5"`, `"-1"`, `"65536"`, `" 80 "` throw an error containing the name and the value |

### Phase 2: Backend (depends on Phase 1)

| #   | Task                                                  | Files                                      | Test first                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | `resolveServerConfig(env)` and `isLoopbackHost(host)` | `apps/backend/config.ts`, `config.test.ts` | Defaults `127.0.0.1:3000`; custom host and port; `AGGCODE_PORT=0` allowed; invalid port throws naming `AGGCODE_PORT`; loopback true for `127.0.0.1`, `::1`, `localhost`, false for `0.0.0.0`                                                       |
| 3   | `startServer` and `ServerStartError`                  | `apps/backend/server.ts`, `server.test.ts` | `{host:"127.0.0.1", port:0}` resolves a real port; a `ws` client connects and the stub `onConnection` runs; `close()` frees it; a second server on the same fixed port rejects with kind `in-use` and a message naming the port and `AGGCODE_PORT` |
| 4   | Rewire `index.ts`                                     | `apps/backend/index.ts`                    | Manual: AC-1 (netstat shows `127.0.0.1:3000`), AC-3 (bad value exits before Mongo), AC-4 (second backend exits 1 with the message), AC-5 (port 0 logs the real port)                                                                               |

### Phase 3: Frontend (depends on Phase 1; parallel with Phase 2)

| #   | Task                                                                     | Files                                                                       | Test first                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | `buildSocketConfig(env)` and the `/api/config` route; drop `/api/hello*` | `apps/frontend/src/serverConfig.ts`, `serverConfig.test.ts`, `src/index.ts` | Default `ws://127.0.0.1:3000`; `AGGCODE_PORT=4100` → 4100; `AGGCODE_BACKEND_URL` wins over the port; `AGGCODE_PORT=0` throws pointing at `AGGCODE_BACKEND_URL`; a non `ws://` / `wss://` backend URL throws |
| 6   | `parseSocketConfig` and `loadSocketConfig`                               | `apps/frontend/src/lib/socketConfig.ts`, `socketConfig.test.ts`             | Global set → returned, injected `fetch` never called; fetch path returns `wsUrl`; network error, 500, HTML body, `{}` and a non-string `wsUrl` all reject                                                   |
| 7   | `useSocket` loads config before connecting                               | `apps/frontend/src/hooks/useSocket.ts`                                      | Manual: normal connect; config route broken → leaves the connecting shell and shows the disconnected text (AC-8)                                                                                            |

### Phase 4: Docs (after 4 and 7)

| #   | Task                                                                         | Files                                                 |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| 8   | New variables in `.env.example`; `CLAUDE.md` and `AGENTS.md` brought in line | `apps/backend/.env.example`, `CLAUDE.md`, `AGENTS.md` |

### Phase 5: Nice to have

| #   | Task                                                          | Files                                                                       | Test first                                                                    |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 9   | `AGGCODE_WEB_PORT` for the frontend server, using `parsePort` | `apps/frontend/src/serverConfig.ts`, `serverConfig.test.ts`, `src/index.ts` | Default 3001; `3101` honoured; invalid value throws naming `AGGCODE_WEB_PORT` |

## Parallel vs sequential

| Parallel group | Tasks             | Why                                            |
| -------------- | ----------------- | ---------------------------------------------- |
| A              | 2, 3              | Separate backend files, both only need Task 1  |
| B              | 5, 6              | Separate frontend files, both only need Task 1 |
| A and B        | 2–3 alongside 5–6 | Backend and frontend don't import each other   |

| Sequential | Depends on | Why                                  |
| ---------- | ---------- | ------------------------------------ |
| 2, 3, 5, 6 | 1          | They import `parsePort`              |
| 4          | 2, 3       | `index.ts` wires them together       |
| 7          | 6          | The hook calls `loadSocketConfig`    |
| 8          | 4, 7       | Docs describe the finished behaviour |
| 9          | 5          | Extends `buildSocketConfig`          |

## Testing plan

| Spec item                                      | Covered by                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| AC-1 loopback by default                       | Task 2 test (default host) + manual netstat in Task 4                       |
| AC-2 port moves the whole app                  | Task 2 and Task 5 tests + manual run on 4100                                |
| AC-3 invalid port stops startup                | Task 1 and Task 2 tests + manual in Task 4                                  |
| AC-4 port in use                               | Task 3 test + manual in Task 4                                              |
| AC-5 port 0 reports the real port              | Task 3 test                                                                 |
| AC-6 `/api/config`, no CORS, `/api/hello` gone | Task 5 test (response body) + manual `curl -i` for headers and `/api/hello` |
| AC-7 global config skips fetch                 | Task 6 test                                                                 |
| AC-8 config failure ends in `closed`           | Task 6 tests + manual in Task 7                                             |
| AC-9 `127.0.0.1`, never `localhost`            | Task 5 test asserts the exact default URL                                   |
| AC-10 docs                                     | Task 8, checked in review                                                   |
| Edge 1 `localhost` → `::1`                     | AC-9 default                                                                |
| Edge 2 port in use                             | AC-4                                                                        |
| Edge 3 invalid values                          | Task 1 table                                                                |
| Edge 4 port 0 on the frontend server           | Task 5 test                                                                 |
| Edge 5 malformed config                        | Task 6 tests                                                                |
| Edge 6 `0.0.0.0` warning                       | Task 2 `isLoopbackHost` test + manual log check                             |
| Edge 7 `onmessage` attached before `init`      | Manual only, see deviation below                                            |

**Deviation from the spec:** edge case 7 asks for a test of the socket/`onmessage` ordering. The frontend has no DOM test setup (no Testing Library, no happy-dom), and adding one for a single test is more than this feature needs. The ordering doesn't change in this feature: `AppContext` still attaches the handler in an effect keyed on `socket`, before the handshake. It is verified by hand (the `init` snapshot fills the sidebar after connect). Revisit when `socket-reconnect` (feature 3) touches the same hook, which will need that test setup anyway.

## Risks

- **`bun --watch` restarts during Task 4.** A restart that runs while the old process still holds the port now exits with the in-use message instead of hanging. That's the intended behaviour, but it will show up in the dev log.
- **Your running dev servers.** Both need a restart to pick up Tasks 4 and 5. The frontend hot-reloads `useSocket`, but the new `/api/config` route lives in `src/index.ts`, which needs a server restart.
