# Spec: OpenCode direct connect

**Created**: 2026-09-24
**Status**: draft
**Author**: team
**Epic**: none

## Problem

The only way to sign in to OpenCode is "Connect Model Provider (API Key)": the user must type a provider id (`openrouter`, `openai`, ...) and paste that provider's key. That is the wrong door for someone who just wants to use OpenCode. OpenCode already ships free models and may already have providers connected through its own CLI, but Aggcode keeps chat disabled until the user hands it a key. Claude has no such wall: "sign in with Claude.ai" needs no credentials, because Aggcode uses the login already on the machine.

## Goal

The OpenCode tab offers a second method, next to the API key one, that needs no provider id and no key. Choosing it turns chat on and Aggcode uses whatever OpenCode already has: its free models plus every provider already connected to it. Sign-out undoes only Aggcode's own opt-in.

## User stories

- As a developer with OpenCode installed, I want to click one button and chat with its free models, without creating a provider account first.
- As a developer who already connected providers with `opencode auth login`, I want Aggcode to offer those models without re-entering keys.
- As a developer who shares OpenCode with other tools, I want Aggcode's sign-out to leave my machine-wide OpenCode logins alone.

## Requirements

### Must have

- **AC-1** The OpenCode tab lists a second method, "Use OpenCode as installed", that has no fields and shows a Connect button. It sits beside the API-key method in the existing method picker.
- **AC-2** Choosing it while signed out records the opt-in and marks OpenCode signed in, so `chatGateRejection` lets a run start on the free models.
- **AC-3** The model list is the built-in free models plus every provider OpenCode reports as connected. (Already built: `providers/openCodeModels.ts`.)
- **AC-4** Sign-out clears only Aggcode's opt-in, plus any sub-provider Aggcode connected through the API-key method (existing behaviour). It never edits `auth.json` and never removes a provider connected outside Aggcode.
- **AC-5** Users who connected through the API key keep today's status and sign-out behaviour, unchanged.
- **AC-6** If the OpenCode server cannot be reached, Connect fails with a message that names the cause, and nothing is stored.

### Nice to have

- The status card says which door the user came through ("Using OpenCode as installed" vs the list of connected providers).

### Out of scope

Assumed; the question was dismissed. Change any of these if wrong.

- Running `opencode auth login` from Aggcode (browser sign-in to providers)
- A provider dropdown in the API-key form
- Grouping or searching a large model list
- Falling back to the default when an OpenCode session's saved model is no longer connected (existing gap, `User.ts` only runs `resolveModel` for Claude)

## Data model

None. `ProviderConfig` already has `authMethod`; the opt-in is `{providerId: "opencode", authMethod: "local"}`. No new collection, no new field.

## API changes

No WebSocket message changes, so the four-place rule for `commons` does not apply.

`getAuthMethods()` for OpenCode gains one entry. `AuthMethodDescriptor` already allows `type: "none"`:

```
{ id: "local", label: "Use OpenCode as installed", type: "none",
  description: "Use OpenCode's free models and any provider already connected to it. No key needed." }
```

`getAuthStatus()` treats OpenCode as signed in when either an external provider is connected (today) or the `local` opt-in is stored. `login({method: "local"})` needs no credentials. `logout()` clears the opt-in.

## UI changes

`ProviderAuthModal.tsx`: a method with no fields and a type other than `oauth` currently renders only its description, with no button, so a no-credential method could not be clicked. It must render a Connect button that submits the method. Everything else in the modal is rendered from the descriptors and needs no change. Design tokens and the shape rules in `apps/frontend/DESIGN.md` apply; the button is the existing `Button`.

## Edge cases

- OpenCode server not running or slow to start: Connect fails with the cause (AC-6); the free-model fallback list is not shown as if signed in.
- Provider connected outside Aggcode and the user also opts in: sign-out clears only the opt-in; the status stays signed in because the external provider is still connected, and the message says so.
- User opted in, then OpenCode loses all providers: still signed in via the opt-in; the list falls back to free models.
- Mongo not connected when Connect is pressed: fails with a message instead of appearing signed in, then losing the state on restart.
- Double click on Connect: idempotent, one stored opt-in.
- Legacy `ProviderConfig` row for `opencode` with only `credentials.*`: reads as no opt-in.

## Testing criteria

- Pure decision function for status (opt-in flag + connected sub-providers -> signed in or not, method, details), unit tested in `apps/backend/providers`.
- Logout planning extended and tested: opt-in only; opt-in plus owned sub-providers; external provider connected.
- `getAuthMethods()` lists both methods, `local` with no fields.
- Frontend: a fields-less method renders a Connect button (logic pulled into a pure helper or checked in the running app, since the modal has no test harness).
- Manual, in the running app: with nothing connected, choose the method, chat works on a free model; sign out returns to the gated state; a provider connected through the CLI stays connected after sign-out.

## Dependencies

- `@opencode-ai/sdk` provider list (`connected`, `default`), already in use
- `ensureOpenCodeServer` in `providers/serverManager.ts`
- The model-list fix in `providers/openCodeModels.ts` (uncommitted on `feature/runtime-config`; should be committed first or with this change)
