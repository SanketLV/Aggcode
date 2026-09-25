# Plan: OpenCode direct connect

**Spec**: .planning/specs/opencode-direct-connect.md
**Epic**: none
**Created**: 2026-09-24
**Status**: draft

Stack: TypeScript on Bun (backend `ws` server + React frontend). Full-stack, backend first. The integration point is the `ProviderDescriptor.authMethods` list the modal already renders, so no wire message changes.

## Architecture

The decision logic goes into pure functions with `bun test` next to them, and the handlers in `opencode.ts` call them. That is the pattern `authScope.ts` already uses (`planOpenCodeLogout`, `chatGateRejection`).

The opt-in is one row: `ProviderConfig {providerId: "opencode", authMethod: "local"}`. The API-key login only writes `credentials.<id>` and never touches `authMethod`, so the two methods coexist on the same row without conflict.

### Components

| Component | Type | Purpose |
|-----------|------|---------|
| `resolveOpenCodeStatus` | pure function (`authScope.ts`) | Decides signed in / not, `method` and `details` from `{externalConnected, optedIn}` |
| `planOpenCodeLogout` (extended) | pure function (`authScope.ts`) | Adds `clearOptIn`: true only for a full sign-out, never for one sub-provider chip |
| `local` auth method | provider plugin (`opencode.ts`) | Descriptor, login (server check + store opt-in), logout (clear opt-in) |
| `methodKind` | pure helper (`frontend/src/lib/authMethod.ts`) | Classifies a method as `fields` / `oauth` / `direct`, so the modal knows when a fields-less method needs a Connect button |
| Connect button branch | component change (`ProviderAuthModal.tsx`) | Renders a submit button for a `direct` method |

### New files

| File | Location | Purpose |
|------|----------|---------|
| `opencode.test.ts` | `apps/backend/providers/` | Descriptor test: both methods listed, `local` has no fields |
| `authMethod.ts` | `apps/frontend/src/lib/` | `methodKind` helper |
| `authMethod.test.ts` | `apps/frontend/src/lib/` | Tests for it |

### Files to change

| File | What changes | Why |
|------|-------------|-----|
| `apps/backend/providers/authScope.ts` | Add `resolveOpenCodeStatus`; add `clearOptIn` to `planOpenCodeLogout` | AC-2, AC-4, AC-5 |
| `apps/backend/providers/authScope.test.ts` | Tests for both | Test first |
| `apps/backend/providers/opencode.ts` | `getAuthMethods` gains `local`; `getAuthStatus` reads the opt-in; `login` handles `local`; `logout` clears the opt-in | AC-1, AC-2, AC-4, AC-6 |
| `apps/frontend/src/components/ProviderAuthModal.tsx` | Fields-less non-oauth method renders a Connect button | AC-1 |
| `CLAUDE.md` | One bullet under "Provider sign-in" | Workflow step 6: durable rule, edited by hand |

## Tasks

### Phase 0: Housekeeping (needs your OK, touches git)

| # | Task | Files |
|---|------|-------|
| 0 | Commit the model-list fix on its own branch off `dev`, then branch this feature from it. It is currently uncommitted on `feature/runtime-config`. | git only |
| 0b | Capture the **before** image of the OpenCode tab (workflow step 3). It has to happen before any UI edit, and before task 2, because the backend change alone adds a button-less method to the modal. Keep images local, never the default 0x0.st upload. | none |

### Phase 1: Backend (sequential, tests first)

| # | Task | Files |
|---|------|-------|
| 1 | Red: tests for `resolveOpenCodeStatus` and `clearOptIn`. Green: implement both. | `authScope.ts`, `authScope.test.ts` |
| 2 | Red: `getAuthMethods` lists `api_key`-style `connect` and `local`, `local` without fields. Green: wire `local` into descriptor, status (opt-in read guarded by `mongoose.connection.readyState === 1`), `login` (`ensureOpenCodeServer()` first, then store; any failure returns `success: false` and stores nothing) and `logout` (clear the opt-in, then the existing owned-sub-provider removal; adjust the "nothing to disconnect" message). | `opencode.ts`, `opencode.test.ts` |

### Phase 2: Frontend (depends on Phase 1 for the descriptor; tasks 3 and 4 sequential)

| # | Task | Files |
|---|------|-------|
| 3 | Red/green: `methodKind(method)`: fields present -> `fields`; `type: "oauth"` -> `oauth`; anything else -> `direct`. | `authMethod.ts`, `authMethod.test.ts` |
| 4 | Modal: replace the inline `fields.length > 0 ? ... : type === "oauth" ? ... : note` chain with `methodKind`; the `direct` branch shows the description and a Connect button using the existing `Button`, `ICON_STROKE`, and the same loading state. No new tokens, no raw palette classes (see `apps/frontend/DESIGN.md`). | `ProviderAuthModal.tsx` |

### Phase 3: Verify and ship (sequential)

| # | Task | Files |
|---|------|-------|
| 5 | `bun run test`, `bun run build`, `bunx tsc --noEmit` on the changed files, then `/code-review`. Verify each finding against the code before acting; last round two of four were wrong. | none |
| 6 | Walk AC-1 to AC-6 in the running app (table below), then take the **after** image. | none |
| 7 | Add the bullet to `CLAUDE.md` under "Provider sign-in". Run `unslop` over commit messages and the PR body, then `/spartan:pr-ready`, then `/sync` after merge. | `CLAUDE.md` |

### Parallel vs sequential

| Parallel group | Tasks | Why |
|---|---|---|
| Group A | 3 | `authMethod.ts` has no dependency on the backend work; can run alongside task 1 or 2 |

| Sequential | Depends on | Why |
|---|---|---|
| Task 2 | Task 1 | Uses `resolveOpenCodeStatus` and the new `planOpenCodeLogout` shape |
| Task 4 | Task 3 | Uses `methodKind` |
| Task 6 | Tasks 2 and 4 | Needs the backend method and the button both present |
| Task 0b | Task 0 | Before image comes from the clean starting state |

## Testing plan

| Test | Level | Covers |
|---|---|---|
| `resolveOpenCodeStatus`: opt-in only -> signed in, method `local` | unit | AC-2 |
| `resolveOpenCodeStatus`: external provider only -> signed in, unchanged text | unit | AC-5 |
| `resolveOpenCodeStatus`: neither -> not signed in | unit | AC-5 |
| `resolveOpenCodeStatus`: both -> signed in, details name the providers | unit | edge: external + opt-in |
| `planOpenCodeLogout`: no target -> `clearOptIn: true`; with a target -> `false`; external target still refused | unit | AC-4 |
| `getAuthMethods`: `local` present, no fields, type `none`; the existing method is unchanged | unit | AC-1 |
| `methodKind`: the three shapes | unit | AC-1 |
| Live: nothing connected, choose the method, send a message on a free model | manual | AC-2, AC-3 |
| Live: sign out, gate returns; a CLI-connected provider is still there in `auth.json` afterward | manual | AC-4 |
| Live: connect through the API key, status text and sign-out identical to before | manual | AC-5 |
| Live: stop the OpenCode server (kill the child), press Connect, error names the cause, reload shows still signed out | manual | AC-6, edge: server down |
| Live: press Connect twice quickly, one stored opt-in | manual | edge: double click |

Edge cases with no automated test: Mongo down (covered by the `readyState` guard and the manual AC-6 check), and a legacy `opencode` row with only `credentials.*` (covered by `resolveOpenCodeStatus` receiving `optedIn: false`).

## Risks

- **Opt-in with a running OpenCode process that has no providers.** The model list falls back to the free models by design; the manual check for AC-3 must run with nothing connected.
- **Sign-out message.** The status can stay "signed in" after sign-out if an external provider is connected. The message must say why, or it will look like a failed sign-out.
- **`authMethod` is a single string.** If a later method also wants it, the two will collide. Fine for now; noted so it is not a surprise.

## Gate 2

- [x] Follows the existing pattern (pure planner in `authScope.ts`, handler calls it)
- [x] Each layer only calls the layer below it: modal -> `methodKind`; `opencode.ts` -> `authScope.ts`
- [x] All changed and new files listed
- [x] Tasks are small (at most 3 files, one commit each)
- [x] Dependencies and parallel groups marked
- [x] Unit tests planned for both new pure functions and the descriptor
- [x] No API or data-layer change, so no integration tests needed
- [x] UI covered by the pure helper plus the manual walk, since the modal has no test harness
- [x] Spec edge cases mapped to tests or manual checks
