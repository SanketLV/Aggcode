# Epic: Desktop app (Windows, macOS, Linux)

**Created**: 2026-09-22
**Status**: draft
**Author**: team

## Why

Aggcode only runs as a developer setup: two dev servers, a MongoDB instance, and a WebSocket open to the whole network. The goal is one installable app per desktop OS that anyone can download and run. Mobile comes later as a remote client and is not part of this epic.

## Decisions already made

- **Shell: Electron.** It bundles one Chromium on every OS, so the code-heavy UI renders the same everywhere. The backend uses no Bun-only APIs (checked 2026-09-22), so it runs on Electron's Node. Tauri was rejected: Linux WebKitGTK rendering, and a second process to package.
- **UI stays React.** No Flutter or React Native. The UI, Streamdown rendering and the `commons` wire types carry over unchanged.
- **Storage: SQLite, start fresh.** Existing Mongo data is not migrated.

## Features, in order

| # | Spec | What it delivers | Depends on |
| --- | --- | --- | --- |
| 1 | `runtime-config` | Backend binds `127.0.0.1` with a configurable port. Frontend finds the backend through config instead of a hardcoded URL. The server start is a callable function Electron can use. | none |
| 2 | `socket-auth` | Per-install token plus Origin allowlist on the WebSocket handshake. The token is delivered through the config from #1. | 1 |
| 3 | `socket-reconnect` | `useSocket` reconnects with capped backoff, and the `init` snapshot is re-applied after a reconnect. | 1, 2 |
| 4 | `sqlite-storage` | `packages/db` moves from mongoose to SQLite. `DB_URL` and the Mongo requirement are gone. | none (can run in parallel with 2 and 3) |
| 5 | `electron-shell` | Electron app that starts the backend in-process on a free port, loads the UI, passes config through preload, and packages installers for all three OSes. | 1–4 |

Each feature is its own spec, plan, branch off `dev`, and PR.

## Out of scope for this epic

- Mobile clients, remote access, relays or tunnels
- Auto-update, code signing and notarization (a follow-up epic once installers exist)
- Multi-user accounts; Aggcode stays single-user per machine
- Migrating existing MongoDB data

## Risks

- **The `claude` and `opencode` CLIs are not bundled.** The packaged app still needs them installed on the user's PATH. Electron apps launched from the macOS Dock or Finder don't inherit the shell's PATH, so #5 must resolve it (a known issue).
- **Native module in the Electron build.** The SQLite driver must build against Electron's Node ABI. #4 picks the driver with this in mind.
- **One port chosen at runtime.** Anything that assumes `:3000` (docs, `before-and-after` workflow) needs updating as the features land.
