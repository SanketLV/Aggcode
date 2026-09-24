# Spec: Live Claude model list

**Created**: 2026-09-24
**Status**: draft
**Author**: team
**Epic**: none

## Problem

The Claude model picker is a hardcoded list (`CLAUDE_CATALOG`, `apps/backend/providers/index.ts:44`), so it drifts from what the Claude Agent SDK actually offers. Today it is already wrong in three ways: Fable is available to the signed-in account but not listed, Opus 4.6 is listed but the SDK no longer offers it, and the SDK reports an `xhigh` effort level that the UI cannot select and the backend silently drops (`claude.ts:398` only accepts low, medium, high, max, so `xhigh` becomes `undefined` with no error). Adding a model means editing code and shipping.

## Goal

The picker shows the models the SDK reports for the signed-in Claude account, with effort levels taken from the SDK too, and it is never slower or less reliable than today: the hardcoded catalog is served whenever the live list is missing, and page load never waits on the SDK.

## User stories

- As a developer whose account has a new model (Fable today), I want it in the picker without waiting for a release of Aggcode.
- As a developer opening the app, I want the picker to appear instantly even when the Claude process is slow or missing.
- As a developer with old sessions, I want a session saved on `claude-sonnet-5` to keep using it.
- As a developer choosing an effort level, I want the levels the chosen model really supports, including `xhigh`, and I never want a selected level dropped without a message.

## Decisions taken

- **Concrete ids, not aliases.** The catalog `id` is the SDK's `resolvedModel` (falling back to `value` when there is none), e.g. `claude-sonnet-5`, not `sonnet`. Existing sessions already store concrete ids, so no migration; a session keeps its model until the user changes it; and `default` and `sonnet` collapse into one row.
- Fallback stays `CLAUDE_CATALOG`, whose ids were each verified with a real SDK run.

## Requirements

### Must have

- **AC-1** The Claude catalog is built from `Query.supportedModels()`: one row per distinct concrete id, name from the SDK `displayName`, `supportsEffort` and effort levels from the SDK. The `default` row is not shown as its own row; its resolved id becomes `defaultModel`.
- **AC-2** If the live list is unavailable (fetch failed, timed out, the `claude` process is missing, or the user is signed out), the picker shows `CLAUDE_CATALOG` exactly as today. Nothing throws and nothing blocks.
- **AC-3** The live list is fetched off the request path: warmed at backend start, cached with a TTL, one fetch in flight at a time, failures not cached, and invalidated when Claude sign-in state changes (the list is per account). `getProviderCatalog()` only ever reads the cache.
- **AC-4** A session that saved a model id present in the live list resolves to it, not to the default. `resolveModel` matches the saved id against the catalog in use, whether live or fallback.
- **AC-5** Effort levels come from the SDK per model, including `xhigh`. The backend accepts a level only if the chosen model lists it, and the UI's effort picker offers exactly those levels. A level the model does not support is not sent, and the UI shows what will run.
- **AC-6** Every concrete id newly reachable through the live list is proven with a real SDK run before it ships (at least Fable and one already-listed id), because an id the SDK rejects fails the whole run. Nothing is added to a test or doc as "verified" without that run.

### Nice to have

- The concrete id as a secondary label on each picker row, so `Sonnet` is distinguishable across releases.

### Out of scope

Assumed; the question was not asked. Change any of these if wrong.

- OpenCode models (already live)
- Model descriptions, pricing, and fast/auto/adaptive-thinking flags from `ModelInfo`
- Any UI that explains per-account differences
- Pushing a live catalog update to already-connected browsers when the background fetch lands (they get it on the next load or the next provider-auth action)
- Changing which model is the default beyond taking the SDK's `default` row

## Data model

None. Sessions keep storing the model id string, as concrete ids.

## API changes

No new WebSocket message. The catalog payload inside `init` and `provider-catalog-updated` (`ProviderOption` in `packages/commons/outgoing.ts`) changes shape slightly:

```ts
type ModelOption = {
  id: string;            // concrete id, e.g. "claude-sonnet-5"
  name: string;
  supportsEffort?: boolean;
  effortLevels?: string[]; // NEW: levels this model supports, e.g. ["low","medium","high","xhigh","max"]
};
```

`ProviderOption.effortLevels` (provider-wide, unused by the UI today) is removed or kept as a fallback, decided in the plan. Because a payload type changes, the four-place rule applies to the parts that consume it: the type in `commons`, `providers/index.ts` (producer), and the `init` / `provider-catalog-updated` handlers in `AppContext.tsx`. No incoming schema and no Mongo schema change.

## Frontend changes

- `apps/frontend/src/components/ChatPane.tsx`: replace the hardcoded `EFFORTS` constant with the selected model's `effortLevels`, mapped to display labels through a small lookup (including `xhigh`). If the saved effort is not in the list, show and use the nearest supported level instead of leaving a stale value.
- Effort labels follow `apps/frontend/DESIGN.md` copy rules; no new tokens.
- No layout change: the effort control stays a ghost `sm` select in the composer toolbar.

## Edge cases

- Signed out of Claude, or the `claude` binary is missing: fetch fails, fallback is served, the failure is not cached, and the next TTL tick or a sign-in retries.
- Backend just started: the first page load can arrive before the warm-up finishes (it took about 7.8s) and will see the fallback. Warming at start makes this rare; it is the documented cost of AC-3.
- `default` and `sonnet` resolve to the same id: one row, named from the non-`default` row.
- A row with no `resolvedModel`: its `value` is the id.
- **Fable's `value` is `claude-fable-5-1[1m]` but `resolvedModel` is `claude-fable-5-1`.** The `[1m]` suffix looks like a 1M-context variant. Which of the two the SDK accepts, and whether they behave differently, is unknown; AC-6's real run decides it before the id is used.
- **Haiku's id changes shape.** The fallback list stores `claude-haiku-4-5`; the SDK's concrete id is `claude-haiku-4-5-20251001`. A saved session on the undated id must still match, so matching accepts a row whose id is the saved id plus a `-YYYYMMDD` date suffix. That one rule lives in `commons` and is used by both the backend (which model runs) and the UI (which model the picker shows), so the two can never disagree about a session.
- A session saved on `claude-opus-4-6`: no longer offered, so it falls back to the default, as any off-catalog id does today. This is a visible behaviour change for those sessions and is noted in the PR.
- A saved effort of `max` on a model whose levels no longer include it: not sent, and the UI shows the level in effect.
- Two overlapping fetches (warm-up plus a request): one in-flight call is shared.
- The SDK returns an empty list: treated as a failure; fallback is served.

## Testing criteria

- Unit, pure mapper: `default` + `sonnet` dedupe to one row; id is `resolvedModel` else `value`; `defaultModel` is the `default` row's resolved id; effort levels copied per model; a model with no effort support has none; an empty list yields "unavailable".
- Unit, cache: failure is not cached and does not clear a previously good value; a success is served until the TTL; concurrent callers share one fetch; invalidation forces a refetch. Use the existing `memoizeAsync` test style in `authScope.test.ts`.
- Unit, `resolveModel`: a saved concrete id in the live list is kept; an id not in it falls back to the default; behaviour with the fallback catalog is unchanged.
- Unit, effort guard: accepts `xhigh` when the model lists it, rejects it when not, and never returns a level outside the model's list.
- Frontend pure helper: effort options for a model, and the nearest-supported-level rule.
- Manual, running app: picker shows Fable and no Opus 4.6; force a fetch failure (rename the `claude` binary from PATH for a backend run) and the picker shows the fallback with no error; measure that `init` time is unchanged with a cold cache; send one real message on Fable with `xhigh` (AC-5, AC-6).

## Dependencies

- `@anthropic-ai/claude-agent-sdk` 0.3.250, `Query.supportedModels()` (starts the Claude Code process; about 7.8s measured)
- `memoizeAsync` in `apps/backend/providers/authScope.ts`
- A signed-in Claude account on the machine for the manual checks

## Open questions

1. **Names.** The SDK `displayName` is just "Sonnet", "Opus", "Fable"; the hardcoded list says "Claude Sonnet 5". Plain SDK names hide the version. Built with the SDK name; the concrete id as a secondary label is still the nice-to-have.

## Answered by real runs (2026-09-24, Claude Code 2.1.250, one tiny prompt each, no tools)

| id | effort | result |
|---|---|---|
| `claude-sonnet-5` | none | runs |
| `claude-opus-5` | `xhigh` | runs, so `xhigh` is accepted |
| `claude-haiku-4-5-20251001` | none | runs |
| `claude-haiku-4-5` (undated) | none | runs, so the date-suffix match loses nothing |
| `claude-opus-4-6` | none | **runs**, although the SDK no longer lists it |
| `claude-fable-5` | `xhigh` | recognised, but fails for this account: "Fable 5 requires usage credits" |
| `claude-fable-5-1` | none | rejected: "Claude Code 2.1.250 does not support this model; version 2.1.251 or newer is required" |

What that decided:

- **Opus 4.6 is kept**, as a legacy row after the live ones, because it still runs. Dropping it would have moved saved sessions to the default for no reason. The rule is general: a built-in model the live list does not cover stays after the live rows.
- **`[1m]` is settled by the docs**: Fable 5.1, Fable 5, Sonnet 5 and Opus 4.7 and later run with the 1M window by default on the Anthropic API, so no suffix is needed. The public `anthropics/claude-code` repo holds docs, plugins and issues, not the application source, so the docs are the reference.
- **The live list is not an entitlement check.** The SDK lists Fable, but a run on an account without usage credits fails. The picker offers it and the run reports the provider's message; the app does not try to predict this.
- **The list changes between runs.** The first list named Fable `claude-fable-5-1`; a later one named it `claude-fable-5`, and only the latter works with the installed CLI. This is the case for reading the list live instead of guessing ids.

## Risks

- **The live list is only as fresh as the installed SDK and CLI.** The docs list `opus` as Opus 5.5 while the installed SDK (0.3.250) resolved `opus` to `claude-opus-5`. Upgrading `@anthropic-ai/claude-agent-sdk` is what moves the live list forward; the picker will not show models newer than the CLI it asks.
- **The picker can offer a model the account cannot run** (Fable without usage credits). The error is the provider's own message.
- **Aliases track, ids pin.** The docs say aliases update over time and full model names pin a version. Concrete ids therefore keep a session on the model it chose; it will not move to a newer one on its own.
