# Design reference

The source of the "Aggcode Redesign" canvas: https://claude.ai/artifact/68Nq3dbGHAu35L8X4wDtUW

| File | What it shows |
| --- | --- |
| `Main.dc.html` | Session transcript: sidebar, tool rows, code block, composer |
| `EmptySession.dc.html` | New session with example prompts |
| `Components.dc.html` | Token swatches, type scale, buttons, badges, shapes, tool row and composer states |
| `Sidebar.dc.html` | The sidebar, imported by the two screens |
| `canvas.json` | Artboard layout of the canvas |
| `before/`, `after/` | Screenshots of the UI before and after the redesign |

The rules behind these screens are in `../DESIGN.md`. When the two disagree, `DESIGN.md` wins.

The `.dc.html` files need the canvas runtime (`support.js`), so they don't render when opened directly in a browser. Open the canvas link to view them, or republish these files to the canvas after editing. Colours here are hex approximations of the OKLCH tokens in `styles/globals.css`.

This folder sits outside `src/` on purpose: `build.ts` bundles every `src/**/*.html`, and these files must not end up in the app.
