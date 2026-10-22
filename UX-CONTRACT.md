# UX contract

MWIDE is an English desktop application for managing projects, model connections, a reusable MCP/Skill catalog, and conversations. Accessibility targets WCAG 2.2 AA. Dates are displayed in the user's local timezone using English formatting. Light is the supported theme, with black-and-white branding and neutral interface tones; reduced motion and forced colors remain usable.

## Business-context sources

| Scope                               | Authoritative source                                | UI consequence                                                                    |
| ----------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Product and delivery                | `docs/product-scope.md`                             | Project-centered conversations and explicit recommendations                       |
| Process and provider boundaries     | `docs/architecture.md`                              | Renderer uses only the typed desktop bridge                                       |
| Canonical records and state         | `src/shared/contracts.ts`, `src/core/validation.ts` | Complete purpose, rules, and architecture remain separately editable              |
| Privacy, permissions, and execution | `docs/product-scope.md`                             | Catalog selection does not install or execute tools                               |
| Catalog removal                     | `src/core/workspace.ts`                             | Confirmation describes catalog/project selection removal; history stays available |

Billing, legal text, cloud synchronization, and autonomous tool authorization have no UI workflow in this milestone. Do not invent them.

## Visual contract

`DESIGN.md` records the established identity. `src/renderer/src/styles.css` owns runtime tokens and maps them directly to shared controls. `workspace-layout.css`, imported after it, owns fixed-viewport geometry and compact sizing. Keep the contract and both layers in sync; no generated theme adapter exists.

The native window startup surface, renderer theme color, logo assets, and shared controls follow the same light theme. States remain distinguishable through labels, borders, icons, and focus treatment in the monochrome palette. A terminal-style utility label never implies that catalog tools can execute commands.

## Canonical UI Map

| Capability     | Canonical owner                                    | Source of truth                    | Allowed variants                                                 | Verification                                              |
| -------------- | -------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| Select/Listbox | Native `select` in forms and `ChatModelControl`    | This contract                      | Native platform popup                                            | Keyboard and open-popup inspection                        |
| Form           | Screen field state and `formValidation.ts`         | Core validation plus this contract | Project, catalog, provider settings                              | Required fields, first-error focus, preserved retry input |
| Textarea       | `Textarea` in `ui.tsx`                             | This contract and runtime CSS      | Form and composer                                                | Auto-grow, long input, bounded scroll                     |
| Dialog         | `ConfirmDialog` in `ui.tsx`, `SidebarDrawer.tsx`   | This contract                      | Discard, catalog removal, compact modal navigation               | Focus, Tab, Escape, focus restoration, failure recovery   |
| Tabs           | `CompactTabs.tsx`                                  | This contract                      | Project context, provider settings, catalog editor               | Arrow keys, Home/End, selected tab and panel association  |
| Navigation     | `WorkspaceSidebar.tsx` with selection in `App.tsx` | This contract                      | Workspace destinations, project switcher, project chat history   | Keyboard expansion, current selection, guarded navigation |
| Scrollbar      | Global styling plus `workspace-layout.css`         | `DESIGN.md`                        | Sidebar, stable message-log gutter, internal editable values     | Scroll ownership, computed styles, forced colors          |
| Chat model     | `ChatModelControl.tsx`                             | Typed bridge and this contract     | Default provider/model selection, Check AI, Configure AI         | Saved setting, explicit discovery, failure feedback       |
| Message text   | `MessageContent.tsx`                               | This contract                      | Safe assistant text and fenced code with copy action             | Code wrapping, copy success/failure, no HTML execution    |
| Feedback       | App error/pending regions and scoped status text   | This contract                      | Error, pending, provider status                                  | Live regions and recovery                                 |
| CRUD           | `useWorkspace` plus owning screen                  | Core service and this contract     | Project enters workspace; catalog returns to list; settings stay | Complete flow and failure paths                           |

## Flow ledger

| Operation               | Pending                                                             | Success                                                           | Failure recovery                                                                   |
| ----------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Create/edit project     | Disable competing changes                                           | Open the project's workspace with saved context                   | Keep the form and its values                                                       |
| Add/edit catalog entry  | Disable competing changes                                           | Close editor and display saved entry                              | Keep editor, values, and inline validation                                         |
| Remove catalog entry    | Named app-owned confirmation; disable duplicate action              | Close dialog and refresh catalog/selections                       | Keep dialog open with an accessible error                                          |
| Save provider settings  | Disable competing changes                                           | Stay on Providers and announce saved status                       | Keep settings and focus invalid URL when applicable                                |
| Change chat model       | Save selected default through the shared mutation state             | Use saved provider/model for subsequent sends                     | Preserve the authoritative settings and show the shared error                      |
| Check AI                | Explicit shared pending state                                       | Show connection result and discovered models                      | Keep configured selection and show connection guidance                             |
| Recommend MCPs & Skills | Shared cancellable pending state                                    | Display suggestions and reasons; explicit Apply changes selection | Preserve project brief and existing selections                                     |
| Start conversation      | Shared cancellable pending state while earlier chats are summarized | Select new conversation                                           | Preserve current conversation and draft                                            |
| First prompt in project | Create a conversation, then submit the prompt under one local guard | Select the created chat and stream its reply                      | Keep the prompt available for retry                                                |
| Send message            | Stream response with Stop action                                    | Keep authoritative history and clear accepted draft               | Restore draft only when send was not accepted; accepted failures remain in history |
| Optimize conversation   | Shared cancellable pending state                                    | Show saved compact memory                                         | Retain existing history and summary                                                |
| Cancel/back/navigation  | Guard unsaved forms                                                 | Return to the selected destination                                | Keep editing when dialog is cancelled                                              |

## Validation and recovery

Forms declare `noValidate`. Required-field errors are text, expose `aria-invalid` and a real `aria-describedby` target, and focus the first invalid field, switching to its section tab when needed. Core validation remains authoritative. User-entered project description, architecture, and rules are saved intact; summaries never overwrite them. Textarea lengths follow the core limits. Native selects, including composer provider/model choices, are acceptable because the platform owns their popup appearance and interaction.

Dirty forms use the shared discard dialog for in-app navigation and a narrow `beforeunload` guard for real window unload. Chat drafts live in application memory by conversation, or by project before its first conversation exists, and survive switching projects during the session; unsent drafts are not promised to survive restart. A failed first-conversation creation keeps the project draft; an unaccepted send restores the prompt in the target conversation. Persisted data is acknowledged only after the desktop service confirms it. Mutations are serialized, with duplicate submission blocked; streaming and background AI work offer cancellation. No automatic mutation retry or offline queue is promised.

## Navigation, feedback, and accessibility

Project chat is the default main surface when projects exist. Startup selects the first available project and its most recent conversation; a project without conversations shows the chat empty state and an enabled composer once a model is chosen. Sending the first prompt creates its conversation automatically. With no projects, the main surface shows the Projects empty state and a create action. Workspace management destinations—Projects, Catalog, and Providers—live in a collapsed sidebar disclosure. The project switcher has its own disclosure and New project action. New conversation and the selected project's chat history remain in the same sidebar, including while a management page is open. History lists the newest conversations first. Switching a project or selecting a conversation returns to that project's chat. Browsing management pages retains the selected project and each project's selected conversation for the current session. A separate inner conversation-list column is not used.

The desktop rail can be collapsed with a labelled toggle. At 760px and below, navigation opens in `SidebarDrawer` using a native modal dialog; it focuses its close action, isolates the background, accepts Escape, and restores focus to its trigger. Selecting a destination closes the compact drawer after the guarded navigation succeeds. Sidebar disclosures retain native keyboard expansion and semantic summary behavior. Project and conversation selection have accessible current-state indicators. In-app navigation continues to guard dirty forms before changing destinations.

Only the sidebar and chat log are content scroll regions. The outer document, main surface, management pages, and form panels do not scroll. Inputs may scroll their own value internally. Chat uses one compact header, the full remaining width, a flexible message log, and a visible bounded composer. Memory details expand inside the log. Management content fits through section tabs and local pagination: project Brief/Rules/Architecture/MCPs & Skills, provider ChatGPT/Ollama/Defaults, and catalog Details/Instructions. `CompactTabs` uses associated panels, a single tab stop, Left/Right arrows, Home, and End. Catalog and project-toolkit pages show two records; the Projects grid calculates capacity from available window space. Page indices clamp after collection or viewport changes. Catalog filters and pagination are transient local state; this desktop workspace has no shareable web route or server pagination contract.

Keyboard focus is visible, controls remain semantic, and icon-only actions have accessible names. Native modal dialog behavior isolates background content and traps focus. Escape cancels a dismissible confirmation. Failed removal is explained inside its dialog; global failures stay visible until dismissed.

The chat log follows generation only when the reader is near the bottom. Switching conversations opens their latest messages. Enter sends; Shift+Enter inserts a newline. Ctrl/Cmd+Enter also sends. IME composition and the composition key code never trigger submission. A saved response replaces its streaming row immediately, even when automatic memory work is still running. The memory status and Stop action stay available until that work finishes; prior assistant messages remain visible when a new send begins. Stop preserves any authoritative partial response and exposes its interrupted status.

Composer provider/model changes save default settings. Check AI explicitly inspects the chosen provider and discovers models; a saved choice does not imply a verified connection. Configure AI opens Providers with the selected project retained. Sending without a model is unavailable and explains how to choose or configure one. Assistant messages render supported text formatting and fenced code through `MessageContent`, without evaluating raw HTML. Code copy reports success or clipboard unavailability. Catalog instructions are displayed as text; MCP execution is explicitly unavailable in this milestone.

## Verification

Run typecheck, lint, formatting, domain/provider tests, production build, and the strict premium UI audit. Keep static audit JSON under ignored `.tools/`; static inspection does not prove runtime behavior. Desktop verification covers fixed viewport/no outer scrolling at 640×480 and larger sizes, sidebar and chat-log scroll ownership, sidebar collapse and compact drawer focus/Escape, tab keyboard behavior, local pagination and page clamping, default project/chat selection, first-prompt creation/failure, history and draft retention, model selection/discovery and connection failures, project/catalog create-edit-cancel, removal confirmation/failure, recommendations and explicit application, real streaming/stop, summary failure, message formatting/code copy, Enter/Shift+Enter/IME, long content, reduced motion, and native select popup behavior. Project setup and catalog editing are the sibling form workflows used for consistency review. Distinguish real provider-response evidence from protocol-only or signed-out checks; do not describe a ChatGPT response as verified without one.
