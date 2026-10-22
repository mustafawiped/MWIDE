---
version: alpha
name: MWIDE
description: A focused desktop workspace for projects, conversations, MCPs, and Skills.
colors:
  background: '#10171f'
  main: '#141e29'
  panel: '#182430'
  border: '#2a3947'
  primary: '#e8eef4'
  secondary: '#a5b5c4'
  muted: '#8398aa'
  accent: '#7cdbc4'
  danger: '#f2c4c9'
  scrollbar-thumb: '#344756'
  scrollbar-track: '#10171f'
  scrollbar-hover: '#506573'
  scrollbar-active: '#7cdbc4'
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  utility:
    fontFamily: "ui-monospace, 'Cascadia Code', monospace"
rounded:
  control: 7px
  card: 10px
  panel: 11px
spacing:
  section-gap: 24px
  page-max: 1370px
components:
  button: {}
  panel: {}
  dialog: {}
  textarea: {}
---

# MWIDE design system

## Overview

MWIDE is a desktop workbench for people managing project context and model conversations. Its existing identity combines layered navy surfaces with a restrained sea-glass accent. The signature is the persistent project/conversation split: project purpose stays close to the conversation. Preserve it when extending the product; this is an application, not a marketing landing page.

All owned copy is English. No Japan-market scope or additional UI locale is currently specified. The primary setting is a desktop or laptop with frequent keyboard use. Keep navigation familiar, content dense enough for work, and decorative motion absent.

Runtime CSS in `src/renderer/src/styles.css` is the canonical token owner. This file mirrors accepted values and records rationale; it does not generate a second theme. Change runtime tokens and this document together. Verify documented values against CSS and run `designmd lint DESIGN.md` after changes.

## Colors

`background` owns navigation, `main` the working surface, and `panel` grouped forms. `primary`, `secondary`, and `muted` express text hierarchy. `accent` marks primary actions, selected navigation, and keyboard focus. `danger` accompanies an explicit error or destructive label; color never carries meaning alone. Dark is the supported theme. Forced-colors mode keeps system-operable scrollbars.

Mapping: `colors.<name>` maps directly to `--<name>` in `styles.css`, including the four `scrollbar-*` tokens. Components consume these variables; badges and selected rows may use the existing tonal surface variants. New feature code should reuse the shared roles.

## Typography

`typography.body` maps to `--font-body` and the root font family. Native system fonts avoid download shifts. Headings use restrained medium weight, with a 29px page title and 16px panel title. Forms and chat use 12px text with generous line height; utility captions may be smaller. `typography.utility` maps to `--font-utility` for preserved catalog instructions. Keep user content's line breaks and permit long identifiers to wrap.

## Layout

The desktop navigation rail is 248px; the content maximum is 1370px. Section gaps are 24px. These values map to `.app-shell`, `.page-content`, and `.editor-grid` in the runtime stylesheet. At 1050px, forms stack; at 720px, navigation becomes a top row; at 480px, conversations become a horizontal strip. Forms scroll with the page. The message log owns chat scrolling and follows new content only while the reader is near the bottom.

## Elevation & Depth

Use surface tone and one-pixel borders for hierarchy. Static panels remain flat. The composer may have its existing subtle shadow; modal confirmations use a darker backdrop and elevation. Native `dialog` uses the top layer, above application content.

## Shapes

Controls map to `--radius-control`, panels and confirmations to `--radius-panel`, and project cards to `--radius-card`. Existing small badges and icon enclosures retain their smaller radius variants. Do not add decorative pills or new shape families.

## Components

`ui.tsx` owns icons, headings, empty states, auto-growing textareas, and confirmation dialogs. Buttons retain primary, secondary, ghost, and danger treatments, with visible hover, focus, active, and disabled states. Busy operations preserve labels and show the shared pending region. Native selects deliberately retain platform-owned popup geometry and keyboard behavior.

Forms use app-owned text validation and field associations. Textareas grow from their declared row count to a bounded scrollable height. Global scrollbar styling applies to every owned scroll region. Dialogs initially focus the safe action, trap focus through native modal behavior, accept Escape as cancellation, and restore trigger focus. English action labels state what happens; empty and failed states explain the next useful action. The hand-drawn stroke icons in `Icon` remain decorative when a text label is present. Reduced motion disables animation.

## Do's and Don'ts

- Keep the complete project purpose and architecture distinct from compact conversation memory.
- Reuse the navy/teal hierarchy, shared form behavior, and explicit action vocabulary.
- Do not present catalog selection as tool execution or provider configuration as a verified connection.
- Do not turn routine work into a hero, add ornamental gradients, or hide scrollbars.
