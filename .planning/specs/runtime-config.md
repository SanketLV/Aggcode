# Spec: Runtime config for the backend address

**Created**: 2026-09-22
**Status**: draft
**Author**: team
**Epic**: desktop-app (feature 1 of 5)

## Problem

The backend listens on every network interface at a fixed port 3000 (`new WebSocketServer({port: 3000})` in `apps/backend/index.ts`), so any device on the same network can connect and drive an agent that edits files with `acceptEdits`. The frontend has `ws://localhost:3000` hardcoded in `hooks/useSocket.ts`, so the backend can't move to another port. A port clash fails silently: the process keeps running and accepts nothing.

## Goal

The backend listens on loopback only, on a port that comes from configuration (including "any free port"). The frontend learns the backend address at runtime. A bad or busy port stops startup with a message that says what to change. The server start can be called as a function, so the Electron shell (feature 5) can start it in-process and read back the real port.

## User stories

- As a developer running Aggcode on a laptop in a café, I want the agent's socket unreachable from other machines, so a stranger on the Wi-Fi can't make it edit my files.
- As a developer with something else on port 3000, I want to set another port in one place and have the UI follow it, without editing source.
- As the Electron shell (feature 5), I want to start the backend on a free port and learn which one it got, so two installs or a dev copy never clash.

## Requirements

### Must have

- `apps/backend/config.ts`: a pure `resolveServerConfig(env)` returning `{host, port}`. `AGGCODE_HOST` defaults to `127.0.0.1`, `AGGCODE_PORT` to `3000`. `0` is allowed and means "OS picks".
- `apps/backend/server.ts`: `startServer({host, port, onConnection})` resolving to `{port, close()}` once listening, rejecting with a typed error on `EADDRINUSE` / `EACCES`. `index.ts` becomes the entry point: connect to the database, `startServer`, log the real URL.
- Frontend server (`apps/frontend/src/index.ts`): `GET /api/config` returns `{"wsUrl": "ws://127.0.0.1:<port>"}`, built from `AGGCODE_BACKEND_URL` if set, else `AGGCODE_PORT`, else 3000. No CORS headers. The leftover `/api/hello` routes are removed.
- `apps/frontend/src/lib/socketConfig.ts`: `loadSocketConfig()` uses `window.__AGGCODE_CONFIG__` if present (Electron will set it through preload), else fetches `/api/config`.
- `useSocket` gets its URL from `loadSocketConfig()`. No socket URL remains hardcoded in `apps/frontend/src`.

### Nice to have

- Frontend port configurable through `AGGCODE_WEB_PORT` (default 3001), so two copies of the app can run side by side for `before-and-after` screenshots.

### Out of scope

- Authentication and Origin checks (feature 2, `socket-auth`)
- Reconnect (feature 3)
- The static `dist/` build from `build.ts`: it has no server, so no `/api/config`. It works again under Electron through `window.__AGGCODE_CONFIG__`.
- Changing `DB_URL` handling (feature 4 removes it)

## Data model

None.

## API changes

No WebSocket message changes, so the four-place rule for `commons` does not apply.

New HTTP route on the frontend server:

```
GET /api/config
200 {"wsUrl":"ws://127.0.0.1:3000"}
```

`window.__AGGCODE_CONFIG__` has the same shape: `{wsUrl: string}`. Feature 2 adds `token` to both.

Environment variables:

| Variable | Read by | Default | Meaning |
| --- | --- | --- | --- |
| `AGGCODE_HOST` | backend | `127.0.0.1` | Interface to bind |
| `AGGCODE_PORT` | backend, frontend server | `3000` | Backend port; `0` = any free port (backend only) |
| `AGGCODE_BACKEND_URL` | frontend server | none | Full `ws://` URL; overrides the port-based default |
| `AGGCODE_WEB_PORT` | frontend server | `3001` | Nice to have |

## UI changes

None visible. While config loads, `useSocket` reports `connecting`, so `ConnectingShell` shows as it does today. If config can't be loaded, status is `closed` and the sidebar shows the existing "Connection lost" text.

## Acceptance criteria

- **AC-1**: With no env vars set, the backend listens on `127.0.0.1:3000` only. A connection to the machine's LAN IP on port 3000 is refused.
- **AC-2**: `AGGCODE_PORT=4100` on the backend and the frontend server moves the app to 4100, and the UI connects with no source edits.
- **AC-3**: A non-numeric or out-of-range `AGGCODE_PORT` (`abc`, `-1`, `70000`) stops startup with a message naming the variable and the value, and a non-zero exit code. Nothing listens.
- **AC-4**: If the port is taken, startup prints `Port 3000 is already in use. Set AGGCODE_PORT to another port.` and exits non-zero, instead of the silent unhandled `EADDRINUSE` today.
- **AC-5**: `startServer({port: 0})` resolves with the real port (> 0), and the startup log prints that port.
- **AC-6**: `GET /api/config` returns the JSON above with no `Access-Control-Allow-Origin` header, and `/api/hello` returns the app's HTML fallback rather than JSON.
- **AC-7**: When `window.__AGGCODE_CONFIG__` is set, `loadSocketConfig()` uses it and makes no network request.
- **AC-8**: If `/api/config` fails (network error, non-200, or JSON without a `wsUrl` string), `useSocket` ends in `closed`. It does not stay in `connecting`.
- **AC-9**: The default URL uses `127.0.0.1`, never `localhost`.
- **AC-10**: `CLAUDE.md` and `apps/backend/.env.example` describe the new variables. The note about the hardcoded URL is replaced.

## Edge cases

1. **`localhost` resolves to `::1` first** (Windows, Node 17+). The server binds IPv4 loopback, so a client dialing `localhost` can fail to connect. That's why the default URL is `127.0.0.1` (AC-9).
2. **Port in use.** Another app, or a second backend started while `bun --watch` is restarting. Must fail loudly (AC-4), not run as a zombie.
3. **Invalid port values**: empty string, `abc`, `3000.5`, `-1`, `65536`. Empty string means default; everything else is an error (AC-3).
4. **`AGGCODE_PORT=0` on the frontend server** has no meaning there, because it can't know the port the backend picked. Treat it as an error in the frontend server and point to `AGGCODE_BACKEND_URL`.
5. **Config response is malformed**, for example an HTML error page or `{}`. Validate the shape, then fail to `closed` (AC-8).
6. **`AGGCODE_HOST=0.0.0.0` set on purpose** (a future remote setup). Allowed, but the backend logs a warning that the agent is reachable from other machines and is unauthenticated until feature 2 lands.
7. **The `socket` starts as `null` for longer.** `AppContext` already guards `if (!socket)` before attaching `onmessage`, and the handler is attached before `open`, so the `init` snapshot is still not missed. A test covers this ordering.

## Testing criteria

Tests sit next to the code (`bun test`).

**Happy path**
- `apps/backend/config.test.ts`: defaults; custom host and port; `0` allowed (AC-1, AC-2, AC-5)
- `apps/backend/server.test.ts`: `startServer` on `127.0.0.1:0` with a stub `onConnection` resolves with a real port, a `ws` client connects and the stub is called, and `close()` frees the port (AC-5)
- `apps/frontend/src/lib/socketConfig.test.ts`: a window global wins without calling `fetch`; the fetch path returns `wsUrl` (AC-7)

**Edge cases**
- `config.test.ts`: every invalid value in edge case 3 throws an error naming `AGGCODE_PORT` (AC-3)
- `server.test.ts`: start two servers on the same fixed port; the second rejects with the in-use error (AC-4)
- `socketConfig.test.ts`: network error, 500, HTML body and `{}` all reject (AC-8)
- Frontend server route logic pulled into a pure `buildConfigResponse(env)` and tested for `AGGCODE_BACKEND_URL` precedence and the `AGGCODE_PORT=0` error (edge case 4)

**Manual, against the running app**
- `netstat -ano | findstr :3000` shows `127.0.0.1:3000`, not `0.0.0.0:3000` or `[::]:3000` (AC-1)
- Start with `AGGCODE_PORT=4100` on both processes; the UI connects and creates a workspace (AC-2)
- Stop the frontend server's config route (or break the URL); the UI leaves the connecting shell and shows the disconnected text (AC-8)

## Dependencies

- None from other specs. Feature 2 builds on `/api/config` and `window.__AGGCODE_CONFIG__`; feature 5 on `startServer`.
- `ws` already supports `host` on `WebSocketServer`; no new packages.
