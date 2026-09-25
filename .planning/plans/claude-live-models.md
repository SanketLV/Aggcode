# Plan: Live Claude model list

**Spec**: .planning/specs/claude-live-models.md
**Epic**: none
**Created**: 2026-09-24
**Status**: draft

Stack: TypeScript on Bun. Full-stack, backend first. The integration point is the `ModelOption` shape inside the catalog payload (`init`, `provider-catalog-updated`); no new message, no Mongo change.

## Architecture

Three rules decide everything, so each becomes a pure function with tests next to it, and the handlers only call them. That is the pattern `authScope.ts` and `openCodeModels.ts` already use.

1. **One matching rule and one effort rule, shared.** `packages/commons/modelRules.ts` holds `findModel` (saved id -> catalog row, accepting a `-YYYYMMDD` date suffix) and `pickEffort` (requested level -> a level the model supports). The backend uses them to decide what runs; the UI uses them to decide what it shows. Putting them in `commons` is what stops the two sides disagreeing about a session.
2. **The catalog is built from the SDK by a pure mapper**, and **cached by a small factory with injected dependencies** (fetch, clock), so cache, TTL and backoff are tested with a fake fetch and a fake clock, without the Claude process.
3. **`getProviderCatalog()` only ever reads the cache.** It never awaits the SDK. A refresh is started in the background when the cache is stale.

### Components

| Component | Type | Purpose |
|-----------|------|---------|
| `findModel`, `pickEffort`, `isEffortLevel` | pure, `commons/modelRules.ts` | Shared matching and effort rules (AC-4, AC-5) |
| `buildClaudeCatalog` | pure, `providers/claudeModels.ts` | SDK rows -> `ProviderOption`: id = `resolvedModel ?? value`, dedupe, drop the `default` row into `defaultModel`, per-model effort (AC-1) |
| `createLiveCatalog` | pure factory, `providers/claudeModels.ts` | Cache with TTL, single in-flight fetch, failure backoff, invalidate; returns the fallback until a live list exists (AC-2, AC-3) |
| `resolveClaudeRun` | pure, `providers/claudeModels.ts` | (catalog, saved model, saved effort) -> `{model, effort}` to run; keeps `User.ts` thin (AC-4, AC-5) |
| `fetchSupportedModels` | SDK call, `providers/claude.ts` | Starts a `query` with a prompt that never yields, calls `supportedModels()`, always closes the process, 60s ceiling |
| `effortOptions` | pure, `frontend/src/lib/effort.ts` | Model -> effort picker options with labels, including `xhigh` (AC-5) |

### New files

| File | Location | Purpose |
|------|----------|---------|
| `modelRules.ts` + `modelRules.test.ts` | `packages/commons/` | Shared rules and their tests |
| `claudeModels.ts` + `claudeModels.test.ts` | `apps/backend/providers/` | Mapper, cache factory, run resolver, and tests |
| `claude.test.ts` | `apps/backend/providers/` | `fetchSupportedModels` closes the process and times out (SDK mocked with `mock.module`) |
| `effort.ts` + `effort.test.ts` | `apps/frontend/src/lib/` | Effort options and labels |

### Files to change

| File | What changes | Why |
|------|-------------|-----|
| `packages/commons/package.json` | Add `"./model-rules"` export | Frontend and backend import the shared rules by subpath, like `commons/types` |
| `packages/commons/outgoing.ts` | `ModelOption.effortLevels?: string[]`; remove the unused provider-level `ProviderOption.effortLevels` | Effort is per model (AC-5); one source of truth |
| `apps/backend/providers/index.ts` | Give each `CLAUDE_CATALOG` model its `effortLevels`, drop the provider-level list; bind the live catalog; export `getClaudeCatalog`, `warmClaudeCatalog`, `invalidateClaudeCatalog`; `getProviderCatalog` reads the cache; `resolveModel` uses `findModel` | AC-1 to AC-4 |
| `apps/backend/providers/claude.ts` | Add `fetchSupportedModels`; replace the four-literal effort whitelist with `isEffortLevel` (SDK `EffortLevel` already includes `xhigh`) | AC-5; today `xhigh` is silently dropped |
| `apps/backend/User.ts` | Use `resolveClaudeRun(getClaudeCatalog(), ...)` for model and effort; call `invalidateClaudeCatalog()` after a Claude login or logout | AC-3, AC-4, AC-5 |
| `apps/backend/index.ts` | Call `warmClaudeCatalog()` at start (not awaited) | AC-3 |
| `apps/frontend/src/components/ChatPane.tsx` | Remove `EFFORTS`; picker options from `effortOptions`; the shown model and effort come from `findModel` and `pickEffort`; changing model also re-picks the effort so the stored config stays coherent | AC-4, AC-5 |
| `apps/backend/providers/index.test.ts` | `resolveModel` cases for the live and fallback catalogs, including the Haiku date-suffix case | AC-4 |

Absent `effortLevels` (OpenCode models) keeps today's four levels, so OpenCode's picker does not change.

## Tasks

Each task is one commit, at most 3 files, tests first.

### Phase 0: Branch (needs the user at the manual steps)

| # | Task | Files |
|---|------|-------|
| 0 | Commit the spec and plan to `feature/claude-live-models` (created off `dev`) through a temporary git worktree, so the running checkout and dev server are not disturbed. | git only |

Build happens on that branch. The manual checks in task 12 need the app running from it, so the user's dev server has to be stopped and restarted on the branch; that is the only step that disturbs it, and it is asked for then.

### Phase 1: Shared rules (commons)

| # | Task | Files |
|---|------|-------|
| 1 | Red/green: `findModel` (exact id, date-suffixed row, unknown -> undefined), `pickEffort` (supported -> same; unsupported -> nearest, ties go lower; no levels -> undefined), `isEffortLevel`. Add the `./model-rules` export. | `modelRules.ts`, `modelRules.test.ts`, `package.json` |
| 2 | Type change: `ModelOption.effortLevels`, remove `ProviderOption.effortLevels`; give `CLAUDE_CATALOG` per-model levels so it still typechecks. | `outgoing.ts`, `providers/index.ts` |

### Phase 2: Backend (sequential)

| # | Task | Files |
|---|------|-------|
| 3 | Red/green: `buildClaudeCatalog`: `default` + `sonnet` become one row; id is `resolvedModel` else `value`; `defaultModel` is the `default` row's resolved id; per-model levels; no effort support gives none; an empty input gives "unavailable". | `claudeModels.ts`, `claudeModels.test.ts` |
| 4 | Red/green: `createLiveCatalog`: serves fallback until live; one fetch in flight; TTL; a failure is not cached and does not clear a good value; **failure backoff** so a signed-out user does not spawn a 7.8s process per catalog read; `invalidate()` forces a refetch. Fake fetch and clock. | `claudeModels.ts`, `claudeModels.test.ts` |
| 5 | Red/green: `resolveClaudeRun`: saved id resolved with `findModel`, else default; effort passed through `pickEffort` for that model; fallback catalog behaves as today. | `claudeModels.ts`, `claudeModels.test.ts` |
| 6 | Red/green: `fetchSupportedModels` closes the query on success, error and timeout; widen the effort guard. | `claude.ts`, `claude.test.ts` |
| 7 | Bind the live catalog, `getProviderCatalog` reads the cache, `resolveModel` uses `findModel`; extend the `index.test.ts` cases (including `claude-haiku-4-5` -> `claude-haiku-4-5-20251001`). | `providers/index.ts`, `providers/index.test.ts` |
| 8 | Wire `User.ts` (resolve run config, invalidate on Claude login/logout) and warm at start. | `User.ts`, `index.ts` |

### Phase 3: Frontend (depends on tasks 1 and 2)

| # | Task | Files |
|---|------|-------|
| 9 | Red/green: `effortOptions(model)` labels including `xhigh`, legacy four when `effortLevels` is absent, none when the model has no effort support. | `effort.ts`, `effort.test.ts` |
| 10 | `ChatPane.tsx`: drop `EFFORTS`, use `effortOptions`, `findModel` and `pickEffort`; re-pick effort on model change. Before editing, capture the "before" image of the toolbar (workflow step 3), local only, never the default 0x0.st upload. | `ChatPane.tsx` |

### Phase 4: Verify and ship

| # | Task | Files |
|---|------|-------|
| 11 | `bun run test`, `bun run build`, `tsc` on the changed files, then `/code-review`. Check every finding against the code before acting on it. | none |
| 12 | Manual walk of AC-1 to AC-6 in the running app (table below), including the real SDK runs. Then the "after" image. | none |
| 13 | Add a bullet under "Provider sign-in" in `CLAUDE.md` (the catalog is live with a verified fallback; ids are concrete; the shared rules). `unslop` over commit messages and the PR body, then `/spartan:pr-ready`, then `/sync` after merge. | `CLAUDE.md` |

### Parallel vs sequential

| Parallel group | Tasks | Why |
|---|---|---|
| Group A | 3-5 and 9 | The mapper/cache work and the frontend helper touch different packages; 9 only needs task 1's `pickEffort` |

| Sequential | Depends on | Why |
|---|---|---|
| Task 2 | Task 1 | Types name the rules' inputs |
| Tasks 3-5 | Task 2 | Build against the new `ModelOption` |
| Task 7 | Tasks 4, 5, 6 | Binds them |
| Task 8 | Task 7 | Calls the exports |
| Task 10 | Tasks 1, 2, 9 | Uses the shared rules and the options helper |
| Task 12 | Tasks 8 and 10 | Needs both sides present and the app running from the branch |

## Testing plan

| Test | Level | Covers |
|---|---|---|
| Mapper: dedupe, id choice, `defaultModel`, per-model effort, empty input | unit | AC-1 |
| Cache: fallback before live; failure not cached; a good value survives a later failure; single flight; TTL; backoff; invalidate | unit, fake fetch and clock | AC-2, AC-3, edge: signed out, overlapping fetches, empty SDK list |
| `findModel`: exact, date suffix (`claude-haiku-4-5`), unknown | unit, commons | AC-4, edge: Haiku id shape |
| `resolveClaudeRun` and `resolveModel`: live and fallback catalogs, Opus 4.6 falls back to the default | unit | AC-4, edge: Opus 4.6 |
| `pickEffort` and `isEffortLevel`: `xhigh` accepted only when listed, nearest level, never outside the model's list | unit, commons | AC-5, edge: `max` on a model without it |
| `fetchSupportedModels` closes the query on success, error and timeout | unit, SDK mocked | AC-2 (no leaked process) |
| `effortOptions`: labels, legacy four, none | unit, frontend | AC-5 |
| Live: picker shows Fable and no Opus 4.6 | manual | AC-1 |
| Live: put `claude` off PATH for a backend run; picker shows the fallback, no error, and the log shows one failed fetch, not one per page load | manual | AC-2, AC-3 |
| Live: `init` time with a cold cache is unchanged | manual, measured | AC-3 |
| Live: a session saved on `claude-haiku-4-5` still shows Haiku and runs on Haiku | manual | AC-4 |
| Live: one real message on Fable with `xhigh`; one on an already-listed id | manual, real SDK run | AC-5, AC-6, edge: `[1m]` |
| Live: send `claude-opus-4-6` explicitly once | manual, real SDK run | edge: Opus 4.6 (keep or drop) |

The UI has no DOM test harness, so the ChatPane change is covered by the pure helpers plus the manual walk.

## Risks

- **The Claude process is heavy.** A fetch is about 7.8s and spawns a process. Backoff (task 4) and closing it in `finally` (task 6) are what keep this from leaking or looping.
- **Freshness is tied to the SDK.** The picker cannot show models newer than the installed CLI. Upgrading `@anthropic-ai/claude-agent-sdk` moves it forward.
- **Behaviour change for Opus 4.6 sessions.** They fall back to the default unless the real run shows the id still works and it is kept as a legacy row. Stated in the PR.
- **First page load right after a backend restart** can show the fallback for a few seconds. Documented in the spec; warming at start makes it rare.
- **Branch switching disturbs the dev server.** Last time it left a stale cache. Task 12 asks before touching it.

## Gate 2

- [x] Follows the existing pattern (pure functions with tests beside them, handlers only call them)
- [x] Each layer only calls the layer below it: UI -> `commons` rules and `effort.ts`; `User.ts` -> `providers/index.ts` -> `claudeModels.ts` -> SDK call in `claude.ts`
- [x] All changed and new files listed, with locations
- [x] Tasks are small (at most 3 files, one commit each), dependencies and parallel group marked
- [x] Unit tests planned for every new pure function and for the process-closing behaviour
- [x] No API endpoint or data-layer change, so no integration tests; the catalog payload change is covered by the type change and the manual walk
- [x] UI covered by the pure helper plus a manual walk, since there is no DOM harness
- [x] Every spec edge case maps to a test or a manual check
