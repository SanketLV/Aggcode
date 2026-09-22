# Spec: Apply the design system to the app

**Created**: 2026-09-22
**Status**: draft
**Author**: team
**Epic**: none (precedes `desktop-app`)

## Problem

The frontend runs on the untouched shadcn neutral theme with no font loaded. It has 19 hand-set type sizes and a few shape rules it doesn't follow. The brightest thing on screen is the user's own message, and the composer is a row of labelled selects with a textarea underneath. The target is written down (`apps/frontend/DESIGN.md`) and drawn (the "Aggcode Redesign" canvas), but the code doesn't follow either.

## Goal

The running app matches the canvas and follows `DESIGN.md`, with no change to behaviour or the wire protocol.

## User story

- As someone reading long agent transcripts, I want the conversation to be the clearest thing on screen and the controls to stay quiet, so I can follow what the agent did without hunting.

## Requirements

### Must have

- Tokens, type scale, radii, `focus-ring` utility and base layer from `DESIGN.md` in `styles/globals.css`. The light palette and unused `chart-*` / `sidebar-primary` tokens are removed.
- Geist and Geist Mono bundled locally (no runtime request to a font CDN).
- Sidebar: status dot + word in the header, `+` button that reveals an inline path input, active session marked with an accent bar on the tree line, hover delete button next to the context menu, Providers list in the footer that opens the sign-in dialog on that provider.
- Chat pane: 56px header matching the sidebar, muted user bubble, composer as one shell with label-free chips and a single helper line, empty session with three example prompts that fill the composer.
- Tool rows: icon for every common tool, status shown as an icon (not colour alone), consecutive rows grouped tighter.
- Provider dialog and confirm dialog: sentence case, shape rules, focus rings, `aria-label` on icon buttons, confirm button repeats the verb.
- Connecting shell pulses and matches the new layout.

### Nice to have

- Error row with an icon (Retry is not included; see out of scope).

### Out of scope

- Relative times on sessions: sessions have no timestamps, so this needs a schema and wire change.
- Retry after a failed run: resending would persist a second copy of the user message. It needs a backend message of its own.
- Anything in the `desktop-app` epic.

## Data model / API changes

None. No `commons` changes.

## UI changes

Files: `styles/globals.css`, `components/ui/button.tsx`, `Sidebar.tsx`, `ChatPane.tsx`, `AssistantTurn.tsx`, `ToolRow.tsx`, `ToolIcon.tsx`, `RunIndicator.tsx`, `ConnectingShell.tsx`, `ConfirmModal.tsx`, `ProviderAuthModal.tsx`, `lib/composer.ts`, new `lib/tools.ts`.

## Acceptance criteria

- **AC-1**: Body text renders in Geist and paths and tool rows in Geist Mono, from bundled files.
- **AC-2**: `apps/frontend/src` has no `text-[Npx]` classes and no raw palette classes (`bg-zinc-*` and the like).
- **AC-3**: The user message bubble uses `bg-muted`, not `bg-primary`.
- **AC-4**: The composer is one rounded shell. The provider, model and effort controls sit inside it with no "Provider:" / "Model:" / "Effort:" prefixes.
- **AC-5**: The line under the composer shows exactly one message: the blocking reason when there is one (offline, signed out, running), else the keyboard hint.
- **AC-6**: The open session is visibly different from a hovered one: an accent bar on the tree line.
- **AC-7**: Sessions and workspaces can be deleted from a visible button, not only from the right-click menu.
- **AC-8**: Every tool row shows its status as an icon (spinner, check, cross). `Bash`, `Grep`, `Write`, `WebFetch`, `WebSearch` and `Task` get their own icons.
- **AC-9**: An empty session shows three example prompts; clicking one fills the composer and does not send.
- **AC-10**: Every interactive element has a visible focus ring, and every icon-only button has an `aria-label`.
- **AC-11**: Copy is in sentence case ("Sign in", "Delete workspace"), and the confirm dialog's button repeats the action.
- **AC-12**: `bun run test` and `bun run build` pass. Workspace, session, message, sign-in and delete flows work as before.

## Edge cases

1. Long workspace paths and session titles truncate without pushing the delete button out of the row.
2. A provider with no models, or a model that doesn't support effort, still renders a tidy toolbar.
3. Signed out and offline at the same time: the helper line shows the offline reason first, because it blocks everything.
4. An empty workspace list and an empty session list keep their empty states.
5. `prefers-reduced-motion`: no spinning or pulsing.

## Testing criteria

- `lib/composer.test.ts`: helper-line priority (offline > signed out > running > hint) and the new placeholders (AC-5, edge case 3)
- `lib/tools.test.ts`: tool name → icon key mapping, including unknown tools (AC-8)
- Manual, against the running app: every AC, with before and after screenshots

## Dependencies

- `geist` npm package for the font files
