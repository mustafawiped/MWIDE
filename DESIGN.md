---
version: alpha
name: MWIDE
description: A focused desktop workspace for projects, conversations, MCPs, and Skills.
colors:
  background: '#f3f3f1'
  main: '#fafaf9'
  panel: '#ffffff'
  border: '#dededb'
  primary: '#202020'
  secondary: '#646462'
  muted: '#727270'
  accent: '#202020'
  on-accent: '#ffffff'
  hover: '#ebebe8'
  selected: '#e5e5e1'
  danger: '#454545'
  scrollbar-thumb: '#c2c2bd'
  scrollbar-track: '#f3f3f1'
  scrollbar-hover: '#92928c'
  scrollbar-active: '#646462'
typography:
  body:
    fontFamily: "'Segoe UI', system-ui, sans-serif"
  utility:
    fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace"
rounded:
  control: 6px
  input: 12px
  card: 16px
  panel: 16px
spacing:
  section-gap: 32px
  page-max: 1180px
  reading-max: 900px
components:
  button: {}
  panel: {}
  dialog: {}
  textarea: {}
---

# MWIDE design system

## Overview

MWIDE is a desktop workbench for people managing project context, model conversations, MCPs, and Skills. Its reference is the familiar sidebar and focused conversation workspace of Claude Desktop and Codex, expressed through the supplied MWIDE black-and-white identity. The signature is a quiet software workspace: a compact navigation rail, readable conversation column, and restrained terminal-style utility labels. Project purpose stays close to the conversation.

The supplied Perplexity style reference informs compact density, off-white surfaces, hairline dividers, modest type weights, and rounded inputs. The user's explicit monochrome direction takes precedence over that reference's teal accent and warm parchment palette. Keep the product task-oriented; do not reproduce a search-engine landing page or add a decorative terminal simulation.

All owned copy is English. No Japan-market scope or additional UI locale is currently specified. The primary setting is a desktop or laptop with frequent keyboard use. Keep navigation familiar, content dense enough for work, and decorative motion absent.

Runtime CSS in `src/renderer/src/styles.css` is the canonical token owner. This file mirrors accepted values and records rationale; it does not generate a second theme. Change runtime tokens and this document together. Verify documented values against CSS and run `designmd lint DESIGN.md` after changes.

## Colors

`background` owns navigation, `main` the working surface, and `panel` grouped forms and the composer. `primary`, `secondary`, and `muted` express text hierarchy. `accent` is ink black for primary actions and keyboard focus; `on-accent` provides its white foreground. `hover` and `selected` distinguish interactive neutral surfaces. `danger` accompanies an explicit error or destructive label; color never carries meaning alone. Light is the supported theme. All interface colors remain neutral. Forced-colors mode keeps system-operable controls and scrollbars.

Mapping: `colors.<name>` maps directly to `--<name>` in `styles.css`, including the four `scrollbar-*` tokens. Components consume these variables; badges and selected rows may use the existing tonal surface variants. New feature code should reuse the shared roles.

## Typography

`typography.body` maps to `--font-body` and the root font family. Segoe UI follows the supplied brand guidance; native fallbacks avoid download shifts. Use 400 and 500 weights throughout, a 28px page title, 16px panel titles, and 14px body text and labels with generous line height. Utility captions may be smaller. `typography.utility` maps to `--font-utility` for technical metadata, keyboard hints, and preserved catalog instructions. Monospace is a quiet utility layer rather than the body font. Keep user content's line breaks and permit long identifiers to wrap.

## Layout

The desktop navigation rail is 252px, reducing to 220px at 1100px and below. The working-area maximum is 1180px; conversation content is capped at a 900px reading width. The project editor section gap is 32px, with compact element gaps and 16–26px component padding. These values map to `.app-shell`, `.page-content`, `.editor-grid`, and the conversation reading column in the runtime stylesheet. At 1100px, forms stack; at 720px, navigation becomes a top row and conversations become a horizontal strip. Forms scroll with the page. The message log owns chat scrolling and follows new content only while the reader is near the bottom.

## Elevation & Depth

Use neutral surface tone and one-pixel borders for hierarchy. Static panels remain flat. The composer may use a restrained one-pixel shadow; modal confirmations use a neutral translucent backdrop and elevation. Native `dialog` uses the top layer, above application content. Avoid gradients, glow effects, decorative imagery, and ornamental motion.

## Shapes

Buttons map to the 6px `--radius-control`; fields and the composer use the 12px `--radius-input`; panels, confirmations, and project cards use the 16px `--radius-panel` and `--radius-card`. Small badges and icon enclosures retain compact radius variants. Do not add decorative pills or new shape families.

## Components

`ui.tsx` owns icons, headings, empty states, auto-growing textareas, and confirmation dialogs. Buttons retain primary, secondary, ghost, and danger treatments, with visible hover, focus, active, and disabled states. Busy operations preserve labels and show the shared pending region. Native selects deliberately retain platform-owned popup geometry and keyboard behavior.

The supplied logo kit is the authority for brand artwork. `src/renderer/src/assets/mwide-horizontal-black.svg` anchors the sidebar; `mwide-symbol-black.svg` supports compact and empty-state use. Preserve their geometry and black artwork, with at least one rail width of clear space. Use the horizontal lockup at 160px or wider and the regular symbol at 24px or larger. The favicon uses the kit's dedicated small drawing. The native window uses the supplied 256px app icon, imported through the Electron asset pipeline so it is included in production output. Brand imagery has fixed dimensions to avoid layout shifts. Do not recreate the mark with text or CSS. The exact tagline is “Easy MCP and Skill Management.”

The native window startup background and HTML theme color match `main` to avoid a dark flash before the renderer appears. There is no independent desktop theme or alternate dark palette.

Forms use app-owned text validation and field associations. Textareas grow from their declared row count to a bounded scrollable height. Global scrollbar styling applies to every owned scroll region. Dialogs initially focus the safe action, trap focus through native modal behavior, accept Escape as cancellation, and restore trigger focus. English action labels state what happens; empty and failed states explain the next useful action. The hand-drawn stroke icons in `Icon` remain decorative when a text label is present. Reduced motion disables animation.

## Do's and Don'ts

- Keep the complete project purpose and architecture distinct from compact conversation memory.
- Reuse the neutral surface hierarchy, black primary actions, shared form behavior, and explicit action vocabulary.
- Keep the supplied logo black on light surfaces and preserve its proportions and clear space.
- Do not present catalog selection as tool execution or provider configuration as a verified connection.
- Do not turn routine work into a hero, add ornamental gradients, or hide scrollbars.
