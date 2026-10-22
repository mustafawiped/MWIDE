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
omitted:
  - section: spacing
    reason: Responsive viewport geometry and compact component spacing are owned by workspace-layout.css.
components:
  button: {}
  panel: {}
  dialog: {}
  textarea: {}
---

# MWIDE design system

## Overview

MWIDE is a desktop workbench for people managing project context, model conversations, MCPs, and Skills. Its reference is the familiar sidebar and focused conversation workspace of Claude Desktop and Codex, expressed through the supplied MWIDE black-and-white identity. The signature is a quiet software workspace: one compact navigation rail keeps the selected project's chat history beside a readable conversation column. Project and tool management remain available through sidebar disclosures, leaving chat as the primary workspace. Restrained terminal-style utility labels support the software setting.

The supplied Perplexity style reference informs compact density, off-white surfaces, hairline dividers, modest type weights, and rounded inputs. The user's explicit monochrome direction takes precedence over that reference's teal accent and warm parchment palette. Keep the product task-oriented; do not reproduce a search-engine landing page or add a decorative terminal simulation.

All owned copy is English. No Japan-market scope or additional UI locale is currently specified. The primary setting is a desktop or laptop with frequent keyboard use. Keep navigation familiar, content dense enough for work, and decorative motion absent.

Runtime CSS in `src/renderer/src/styles.css` is the canonical color, typography-family, and radius token owner. `src/renderer/src/workspace-layout.css`, imported after it, owns viewport geometry and compact component sizing. This file mirrors accepted values and records rationale; it does not generate a second theme. Change runtime tokens and this document together. Verify documented values against CSS and run `designmd lint DESIGN.md` after changes. The earlier fixed content-width and section-gap tokens do not define the current viewport layout.

## Colors

`background` owns navigation, `main` the working surface, and `panel` grouped forms and the composer. `primary`, `secondary`, and `muted` express text hierarchy. `accent` is ink black for primary actions and keyboard focus; `on-accent` provides its white foreground. `hover` and `selected` distinguish interactive neutral surfaces. `danger` accompanies an explicit error or destructive label; color never carries meaning alone. Light is the supported theme. All interface colors remain neutral. Forced-colors mode keeps system-operable controls and scrollbars.

Mapping: `colors.<name>` maps directly to `--<name>` in `styles.css`, including the four `scrollbar-*` tokens. Components consume these variables; badges and selected rows may use the existing tonal surface variants. New feature code should reuse the shared roles.

## Typography

`typography.body` maps to `--font-body` and the root font family. Segoe UI follows the supplied brand guidance; native fallbacks avoid download shifts. Use 400 and 500 weights throughout. Conversation messages use 14px text with a 1.65 line height; management page titles use 24px, reducing to 21px in narrow or short windows. Compact chat headings, panel headings, fields, labels, and utility captions use the smaller sizes defined by the geometry stylesheet. `typography.utility` maps to `--font-utility` for technical metadata, keyboard hints, and code. Monospace is a quiet utility layer rather than the body font. Keep user content's line breaks and permit long identifiers to wrap.

## Layout

The application fills a fixed `100dvh` viewport. The document, root, application shell, main surface, management pages, and form panels do not scroll. The two content scroll owners are the sidebar and the chat message log. Text inputs may scroll their own editable value internally. Use `min-height: 0` and bounded flex/grid children throughout; adding page or panel overflow is not a remedy for content that does not fit.

The desktop navigation rail uses `clamp(216px, 18vw, 252px)` and can be collapsed. It contains the brand, a collapsed Workspace disclosure for Projects, Catalog, and Providers, a project switcher with a New project action, New conversation, and the selected project's chat history. Keep history in this single rail; the conversation screen does not add another conversation-list column. At 760px and below, the rail opens as the native modal `SidebarDrawer` above the main surface. All navigation and history remain reachable through its toggle.

Project chat uses the full remaining width, without the earlier 900px reading cap or a centered maximum-width page. A single compact header contains sidebar access, project and conversation identity, automatic memory status, and project context. The outer application bar is omitted on chat. The message log takes all remaining height above the composer. Memory optimization runs in the background without a manual setting or expandable optimization panel. The composer stays visible while messages scroll and grows only to its bounded input height.

Management uses compact section tabs and local pagination instead of page or form scrollbars. Project setup separates Brief, Folder, Code index, Rules, Architecture, and MCPs & Skills; Providers separates ChatGPT, Ollama, and Defaults; catalog editing separates Details and Instructions. Catalog lists, project toolkit selection, and Code index symbol/call results show two entries per page. The Projects grid adapts its page size to available window space. Actions remain visible within the viewport. At short heights, reduce spacing and secondary explanatory copy before constraining editable fields.

The native window opens at 90% of the primary display work area, clamped between 640×480 and 1440×960. The minimum supported window is 640×480. Verify compact states at that size; expanding the default window is not a substitute for fitting the workspace.

## Elevation & Depth

Use neutral surface tone and one-pixel borders for hierarchy. Static panels remain flat. The composer may use a restrained one-pixel shadow; modal confirmations use a neutral translucent backdrop and elevation. Native `dialog` uses the top layer, above application content. Avoid gradients, glow effects, decorative imagery, and ornamental motion.

## Shapes

Buttons map to the 6px `--radius-control`; fields and the composer use the 12px `--radius-input`; panels, confirmations, and project cards use the 16px `--radius-panel` and `--radius-card`. Small badges and icon enclosures retain compact radius variants. Do not add decorative pills or new shape families.

## Components

`ui.tsx` owns icons, headings, empty states, auto-growing textareas, and confirmation dialogs. Buttons retain primary, secondary, ghost, and danger treatments, with visible hover, focus, active, and disabled states. Busy operations preserve labels and show the shared pending region. Native selects deliberately retain platform-owned popup geometry and keyboard behavior.

`CompactTabs` owns management section navigation, with arrow-key, Home, and End behavior and associated tab panels. `SidebarDrawer` owns the compact modal navigation surface, including initial focus, Escape dismissal, and focus restoration. `ChatModelControl` owns the composer provider/model selects, explicit Check AI connection/model discovery, and Configure AI navigation. Changing a selection saves the default settings; it does not prove a live connection.

`ProjectCodeIndex` is the read-only Code index tab inside project context. It reuses shared buttons, the native select, neutral surfaces, and utility typography; `project-code-index.css` owns only its bounded panel geometry and compact result density. Counts, change summaries, unresolved/partial coverage, and pagination remain textual. Search symbols opens paged declarations; selecting a symbol shows Calls made or Callers, with Back to symbols retaining the search. Keep this an evidence view rather than an interactive graph canvas or a second editor. The Folder tab owns the native folder choice and saved selection prerequisite; no new palette, font, elevation, or radius family is introduced.

`MessageContent` renders assistant paragraphs, modest headings, lists, bold text, inline code, and fenced code without interpreting model output as HTML. Code blocks use utility typography and expose Copy code with success or unavailable feedback. Wrap long code within the chat log rather than introducing another content scroller.

Sidebar disclosures use compact neutral summary rows with a visible expansion indicator. Project and conversation entries expose selection without relying on color alone. Keep the project switcher and chat history available while browsing Workspace pages so the selected project stays visible and returning to a conversation remains direct.

The supplied logo kit is the authority for brand artwork. `src/renderer/src/assets/mwide-horizontal-black.svg` anchors the sidebar; `mwide-symbol-black.svg` supports compact and empty-state use. Preserve their geometry and black artwork, with at least one rail width of clear space. Use the horizontal lockup at 160px or wider and the regular symbol at 24px or larger. The favicon uses the kit's dedicated small drawing. The native window uses the supplied 256px app icon, imported through the Electron asset pipeline so it is included in production output. Brand imagery has fixed dimensions to avoid layout shifts. Do not recreate the mark with text or CSS. The exact tagline is “Easy MCP and Skill Management.”

The native window startup background and HTML theme color match `main` to avoid a dark flash before the renderer appears. There is no independent desktop theme or alternate dark palette.

Forms use app-owned text validation and field associations. Textareas grow from their declared row count to a bounded height and may scroll their editable value internally. Global scrollbar styling applies to every owned scroll region. Confirmation dialogs initially focus the safe action, trap focus through native modal behavior, accept Escape as cancellation, and restore trigger focus. English action labels state what happens; empty and failed states explain the next useful action. The hand-drawn stroke icons in `Icon` remain decorative when a text label is present. Reduced motion disables animation.

## Do's and Don'ts

- Keep the complete project purpose and architecture distinct from compact conversation memory.
- Give project chat and its history priority; group management destinations inside the sidebar Workspace disclosure.
- Keep the document fixed to the viewport; fit management content with tabs and pagination, and reserve content scrolling for the sidebar and message log.
- Reuse the neutral surface hierarchy, black primary actions, shared form behavior, and explicit action vocabulary.
- Keep the supplied logo black on light surfaces and preserve its proportions and clear space.
- Do not present catalog selection as tool execution or provider configuration as a verified connection.
- Do not turn routine work into a hero, add ornamental gradients, or hide scrollbars.
