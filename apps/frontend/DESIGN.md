# Aggcode design system

The rules every screen in `apps/frontend` follows. Tokens live in `styles/globals.css`; this file explains them and says when to use each one. If code and this file disagree, fix one of them in the same change.

## Direction

Aggcode is a tool for reading agent transcripts: mostly code, tool output and file paths, for long stretches of time. The design follows from that:

1. **The transcript comes first.** Chrome (sidebar, header, composer controls) sits quieter than the content: lower contrast, smaller type, no fills.
2. **One accent, used rarely.** The accent marks exactly three things: the primary action (send / submit), the active item, and keyboard focus. Anything else that uses it dilutes it.
3. **Depth comes from surface lightness, not shadows.** On a dark UI, "higher" means a slightly lighter surface. Shadows are only for things that float (popovers, dialogs).
4. **Status is never colour alone.** Every success, warning or error state also has an icon or a word.
5. **Honest UI.** Indicators report real state (see `RunIndicator`). No fake progress, no hints for features that don't exist.

Dark mode is locked (`class="dark"` on `<html>`). There is no light palette, so the tokens below are defined once, on `:root`.

---

## Colour

Neutrals are tinted cool (hue 265, chroma ≤ 0.012) instead of the pure grey (`chroma 0`) of the shadcn defaults. That removes the flat, unfinished look without reading as "blue".

### Surfaces (darkest → lightest)

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `oklch(0.16 0.006 265)` | App ground, transcript pane |
| `--sidebar` / `--card` | `oklch(0.185 0.007 265)` | Sidebar, tool rows, cards |
| `--popover` | `oklch(0.21 0.008 265)` | Menus, selects, dialogs |
| `--muted` | `oklch(0.235 0.009 265)` | Skeletons, code-ish chips, user bubble |
| `--accent` | `oklch(0.26 0.01 265)` | Hover and selected **surfaces** (not the brand accent, see note) |

> Naming note: shadcn calls the hover surface `accent`. Our brand colour is `primary`. Don't confuse them: `bg-accent` is grey.

### Text

| Token | Value | Contrast on `--background` | Use |
| --- | --- | --- | --- |
| `--foreground` | `oklch(0.96 0.004 265)` | ~16:1 | Body text, transcript |
| `--muted-foreground` | `oklch(0.71 0.012 265)` | ~7.5:1 | Secondary labels, paths, meta |
| `--subtle-foreground` | `oklch(0.60 0.012 265)` | ~4.9:1 | Tertiary only: timestamps, counters, placeholder |

Nothing below `--subtle-foreground` is allowed for text. It is the 4.5:1 floor.

### Lines

| Token | Value | Use |
| --- | --- | --- |
| `--border` | `oklch(1 0 0 / 7%)` | Default dividers, panel edges |
| `--border-strong` | `oklch(1 0 0 / 13%)` | Composer, dialogs, hovered inputs |
| `--input` | `oklch(1 0 0 / 11%)` | Input borders |

### Brand accent

| Token | Value | Use |
| --- | --- | --- |
| `--primary` | `oklch(0.78 0.1 225)` | Send button, submit buttons, active-item marker, focus ring |
| `--primary-foreground` | `oklch(0.2 0.03 225)` | Text/icons on `--primary` |
| `--ring` | `oklch(0.78 0.1 225 / 70%)` | Focus outline |

"Glacier" is a desaturated cyan-blue, chosen because it doesn't collide with any of the status hues (green 160, amber 85, red 25) and isn't the purple "AI gradient" hue. To re-brand, change the hue in these three lines and nothing else.

### Status

| Token | Value | Use |
| --- | --- | --- |
| `--success` | `oklch(0.77 0.14 160)` | Signed in, tool finished |
| `--warning` | `oklch(0.83 0.14 85)` | Needs sign-in, attention |
| `--destructive` | `oklch(0.7 0.18 25)` | Errors, delete |

Status recipe: `bg-{status}/10 text-{status} border-{status}/25`, always with an icon or a word.

### Forbidden

- Raw palette classes (`bg-zinc-900`, `text-blue-400`). Semantic tokens only.
- `bg-primary` on anything that isn't an action, the active marker or focus. **In particular, user messages are not `bg-primary`**. See "Message bubbles".
- Gradients, glows, or a second accent colour.

---

## Typography

**Families**: Geist Sans for UI and prose, Geist Mono for paths, tool rows and code. Both come from the `geist` package as variable woff2 files, declared with `@font-face` in `globals.css` and inlined into the CSS bundle by the build, so nothing is fetched at runtime. Fallbacks: `ui-sans-serif, system-ui` and `ui-monospace, "Cascadia Code", Consolas`.

**Custom sizes and `cn()`**: `text-micro`, `text-ui`, `text-title` and `text-display` are registered with `tailwind-merge` in `lib/utils.ts`. Add any new `--text-*` token there too, or `cn()` will read it as a colour and silently drop it.

**Scale** (dense app UI, 14px body). These are defined as `--text-*` in `@theme`, so they become Tailwind classes:

| Class | Size / line-height | Weight | Use |
| --- | --- | --- | --- |
| `text-display` | 20px / 1.3, `-0.015em` | 600 | Empty-state headings only |
| `text-title` | 15px / 1.4, `-0.01em` | 600 | Pane header, dialog titles |
| `text-sm` | 14px / 1.6 | 400 | Transcript prose, user messages, composer |
| `text-ui` | 13px / 1.4 | 400 / 500 | Sidebar rows, buttons, menu items |
| `text-xs` | 12px / 1.45 | 400 | Helper text, meta, captions |
| `text-micro` | 11px / 1.4 | 500 | Mono only: paths, tool rows, badges |

Rules:

- **No arbitrary sizes** (`text-[11px]`, `text-[10px]`). Use `text-micro`. 10px is gone.
- Weights: 400 body, 500 labels and buttons, 600 titles. No 700.
- Numbers that change (elapsed time, token counts) are `tabular-nums`.
- Sentence case everywhere: "Sign in", "Delete workspace", "Connected accounts". No Title Case.
- `text-wrap: pretty` on prose, `balance` on headings (already in the base layer).
- Prose is capped at `70ch` (`.transcript-prose`), code and tables stay full width.

---

## Spacing

Tailwind's 4px scale, with these fixed values so panes line up:

| Where | Value |
| --- | --- |
| Pane horizontal padding (header, transcript, composer) | `px-5` (20px) |
| Sidebar padding | `p-2` list, `px-3` header/footer |
| Row height: sidebar item | 32px (`h-8`) |
| Row height: compact control (chips, selects in composer) | 28px (`h-7`) |
| Row height: default control | 36px (`h-9`) |
| Gap between transcript turns | `gap-6` |
| Gap between parts in a turn | `gap-2` |
| Transcript column and composer | `max-w-3xl` (768px) |

Header and composer share the same horizontal padding as the transcript, so the three edges align.

---

## Shape

| Token | Value | Use |
| --- | --- | --- |
| `rounded-sm` | 4px | Badges, `kbd`, inline chips |
| `rounded-md` | 6px | Every interactive control: buttons, inputs, selects, sidebar rows, tool rows |
| `rounded-lg` | 8px | Panels, message bubbles, banners |
| `rounded-xl` | 12px | Composer shell, dialogs |
| `rounded-full` | — | **Dots only** (status dots, avatars). Never pills. |

Inner radius = outer radius − padding, so a control inside the composer is `rounded-md` inside `rounded-xl`.

---

## Elevation

| Level | Surface | Shadow |
| --- | --- | --- |
| 0 | `bg-background` | none |
| 1 | `bg-card` + `border-border` | none |
| 2 (floating) | `bg-popover` + `border-border-strong` | `--shadow-float`: `0 12px 32px -8px oklch(0.05 0.02 265 / 60%)` |

The composer is level 1 with `border-border-strong`, plus a 1px top highlight (`shadow-[inset_0_1px_0_oklch(1_0_0/4%)]`) so it reads as the one raised thing on the transcript pane.

---

## Motion

- Colour and background: `transition-colors duration-150`.
- Expand/collapse and dialogs: 200ms `ease-out`, `transform` and `opacity` only.
- Press: `active:translate-y-px` on buttons.
- Spinners are `Loader2` with `animate-spin`. Skeletons are `animate-pulse`.
- Every animated element carries `motion-reduce:transition-none` / `motion-reduce:animate-none`.
- No animation library.

---

## Focus

One utility, defined in `globals.css`:

```css
@utility focus-ring {
  &:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
}
```

Every interactive element gets `focus-ring`. It replaces the `focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none` string that is copied across the components today and is missing from several (provider tabs, sub-provider remove buttons).

---

## Iconography

lucide-react only, `strokeWidth={ICON_STROKE}` (1.5). Sizes: `size-3.5` in rows and chips, `size-4` in buttons, `size-5` in empty states. Icon-only buttons must have `aria-label` (a `title` is not enough).

`ToolIcon` maps each tool name to an icon: `Read → FileText`, `Edit/Write → FilePen`, `Glob/Grep → Search`, `Bash → SquareTerminal`, `WebFetch/WebSearch → Globe`, `Task → Workflow`, fallback `Wrench`.

---

## Components

Build on `components/ui/*` (`Button`, `Input`, `Textarea`, `Select`, `Dialog`). Don't restyle a raw `<button>` or `<input>` inline when a primitive exists.

### Button

| Variant | Recipe | Use |
| --- | --- | --- |
| `default` | `bg-primary text-primary-foreground hover:bg-primary/90` | One per view: send, submit |
| `secondary` | `bg-muted text-foreground hover:bg-accent` | Secondary actions |
| `ghost` | `text-muted-foreground hover:bg-accent hover:text-foreground` | Toolbar and row actions |
| `destructive` | `bg-destructive/12 text-destructive hover:bg-destructive/20` | Delete, sign out (tinted, not solid red) |

Sizes: `sm` h-7, `default` h-9, `icon` size-8. All `rounded-md`, `text-ui font-medium`.

### Sidebar item

- 32px row, `rounded-md px-2 text-ui`.
- Hover: `bg-accent/60`. **Active: `bg-accent text-foreground` plus a 2px `bg-primary` bar on the left edge.** Active must not look like hover.
- Secondary line (path) is `font-mono text-micro text-muted-foreground`.
- Row actions (delete) appear as a ghost icon button on hover/focus, in addition to the context menu, so they are discoverable.
- The active marker sits on the session tree line (`-left-[9px]`), so the line itself lights up at the open session.
- Header: mark, "Aggcode", and a status dot + word ("Connected" / "Reconnecting"). Adding a workspace is a `+` ghost button in the header that reveals an inline path input, not a form fixed to the bottom.
- Footer: a "Providers" list, one row per provider with a status dot and word ("Signed in" / "Sign in"). Clicking a row opens the sign-in dialog on that provider.

### Composer

One shell, not a textarea with a control row floating above it:

```
┌──────────────────────────────────────────────────────┐  rounded-xl, bg-card,
│ Ask Claude to change something in aggcode…           │  border-border-strong
│                                                      │
│ [● Claude ▾] [Opus 5 ▾] [High ▾]              [ ↑ ]  │  toolbar row inside
└──────────────────────────────────────────────────────┘
  Enter to send · Shift+Enter for a new line               text-xs subtle
```

- Textarea: borderless, transparent, `text-sm`, `field-sizing-content`, `max-h-48`.
- Toolbar: ghost `sm` selects with no "Provider:" / "Model:" prefixes. The value says what it is ("Claude", "Opus 5", "High effort"). The provider chip carries the auth dot: success dot when signed in, warning dot + "Sign in" when not.
- Send: `size-8 rounded-md bg-primary`, disabled at `opacity-40`.
- Focus-within on the shell: `border-ring/60`.
- The helper line under the shell says exactly one thing: the blocking reason when there is one (offline, signed out, running), otherwise the keyboard hint.

### Message bubbles

- **User**: `rounded-lg bg-muted text-foreground px-3.5 py-2.5 max-w-[80%]`, right-aligned. It's the user's own words, so it gets the quietest treatment, not the loudest. (Today it is `bg-primary`, a near-white slab and the brightest thing on screen.)
- **Assistant**: unbubbled, full column width (`AssistantTurn`). Unchanged.
- **Error**: `rounded-lg border border-destructive/25 bg-destructive/8 text-destructive` with an `AlertCircle` icon and, when retryable, a ghost "Retry" button.

### Tool row

- `rounded-md border-border bg-card`, header `h-8 px-2.5 font-mono text-micro`.
- Status is shown with an icon on the right: `Loader2` (running), `Check` in `text-success` (done), `X` in `text-destructive` (error). Colour alone isn't enough.
- Output: `font-mono text-micro text-muted-foreground`, `max-h-64 overflow-auto`, with the output area on `bg-background` so it reads as "inset".
- Consecutive tool rows sit with `gap-1`, not `gap-2`, so a burst of tool calls reads as one group.

### Badge / status chip

`inline-flex items-center gap-1.5 rounded-sm px-1.5 h-5 text-micro font-medium` with the status recipe. No `rounded-full` pills.

### Dialog

`rounded-xl bg-popover border-border-strong shadow-float`, `text-title` heading. Confirm dialogs name the thing and the consequence, and the confirm button repeats the verb ("Delete workspace", not a generic "Delete" or "OK").

### Pane header

`h-14 px-5 border-b border-border` (56px, the same height as the sidebar header so the two lines meet), left: session title (`text-title` truncated) with workspace name + path (`font-mono text-micro text-muted-foreground`) below or beside it. Right: run status when a run is live.

---

## States

Every view designs all of these:

| State | Pattern |
| --- | --- |
| Loading (connect) | `ConnectingShell` skeleton with `animate-pulse`, same geometry as the real layout |
| Empty list | Icon `size-5 text-subtle-foreground` + one sentence + the action that fills it |
| Empty session | Short heading + 3 example prompts as ghost buttons that fill the composer |
| Running | `RunIndicator` (real state only) |
| Error | Inline, next to the thing that failed, with a recovery action |
| Offline | Composer disabled with the reason in the helper line, status dot in sidebar header turns `warning` |

---

## Copy

- Sentence case. "Sign in", "Signed in", "Delete workspace", "Connected accounts".
- Say what happens, not "Are you sure": "Delete **aggcode** and its 4 sessions? This can't be undone."
- Use the real ellipsis `…`, not `...`.
- No exclamation marks, no "Oops".
- Placeholders are examples, not instructions: `D:\Projects\my-app`.

---

## Tokens (paste into `styles/globals.css`)

Replaces the `:root` and `.dark` blocks. The light palette and the unused `chart-*` / `sidebar-primary` tokens are dropped because dark mode is locked.

```css
@theme inline {
  /* existing --color-* mappings stay; add: */
  --color-subtle-foreground: var(--subtle-foreground);
  --color-border-strong: var(--border-strong);

  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, "Cascadia Code", Consolas, monospace;

  --text-micro: 0.6875rem;
  --text-micro--line-height: 1.4;
  --text-ui: 0.8125rem;
  --text-ui--line-height: 1.4;
  --text-title: 0.9375rem;
  --text-title--line-height: 1.4;
  --text-title--letter-spacing: -0.01em;
  --text-display: 1.25rem;
  --text-display--line-height: 1.3;
  --text-display--letter-spacing: -0.015em;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  --shadow-float: 0 12px 32px -8px oklch(0.05 0.02 265 / 60%);
}

:root {
  --background: oklch(0.16 0.006 265);
  --foreground: oklch(0.96 0.004 265);
  --card: oklch(0.185 0.007 265);
  --card-foreground: var(--foreground);
  --sidebar: oklch(0.185 0.007 265);
  --sidebar-foreground: var(--foreground);
  --popover: oklch(0.21 0.008 265);
  --popover-foreground: var(--foreground);
  --muted: oklch(0.235 0.009 265);
  --muted-foreground: oklch(0.71 0.012 265);
  --subtle-foreground: oklch(0.6 0.012 265);
  --accent: oklch(0.26 0.01 265);
  --accent-foreground: var(--foreground);
  --secondary: var(--muted);
  --secondary-foreground: var(--foreground);

  --primary: oklch(0.78 0.1 225);
  --primary-foreground: oklch(0.2 0.03 225);
  --ring: oklch(0.78 0.1 225 / 70%);

  --border: oklch(1 0 0 / 7%);
  --border-strong: oklch(1 0 0 / 13%);
  --input: oklch(1 0 0 / 11%);

  --success: oklch(0.77 0.14 160);
  --warning: oklch(0.83 0.14 85);
  --destructive: oklch(0.7 0.18 25);
}

@utility focus-ring {
  &:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground font-sans antialiased;
  }
  h1, h2, h3 { text-wrap: balance; }
  p { text-wrap: pretty; }
  ::selection { background: oklch(0.78 0.1 225 / 30%); }
}
```

---

## Review checklist

Before merging a UI change:

- [ ] Only semantic tokens, no raw palette classes, no arbitrary `text-[..px]`
- [ ] `bg-primary` used only for the primary action, active marker or focus
- [ ] Controls `rounded-md`, panels `rounded-lg`, shells `rounded-xl`, no pills
- [ ] Every interactive element has `focus-ring`; icon-only buttons have `aria-label`
- [ ] Status has an icon or word, not colour alone
- [ ] Sentence case, specific copy
- [ ] Empty, loading, error and offline states handled
- [ ] `motion-reduce` companion on every transition/animation
