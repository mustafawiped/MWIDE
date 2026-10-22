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

`DESIGN.md` records the established identity. `src/renderer/src/styles.css` owns runtime tokens and maps them directly to shared controls. Keep both in sync; no generated theme adapter exists.

The native window startup surface, renderer theme color, logo assets, and shared controls follow the same light theme. States remain distinguishable through labels, borders, icons, and focus treatment in the monochrome palette. A terminal-style utility label never implies that catalog tools can execute commands.

## Canonical UI Map

| Capability     | Canonical owner                                    | Source of truth                    | Allowed variants                                                 | Verification                                              |
| -------------- | -------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| Select/Listbox | Native `select` in provider/catalog forms          | This contract                      | Native platform popup                                            | Keyboard and open-popup inspection                        |
| Form           | Screen field state and `formValidation.ts`         | Core validation plus this contract | Project, catalog, provider settings                              | Required fields, first-error focus, preserved retry input |
| Textarea       | `Textarea` in `ui.tsx`                             | This contract and runtime CSS      | Form and composer                                                | Auto-grow, long input, bounded scroll                     |
| Dialog         | `ConfirmDialog` in `ui.tsx`                        | This contract                      | Discard and catalog removal                                      | Focus, Tab, Escape, safe action, failure recovery         |
| Navigation     | `WorkspaceSidebar.tsx` with selection in `App.tsx` | This contract                      | Workspace destinations, project switcher, project chat history   | Keyboard expansion, current selection, guarded navigation |
| Scrollbar      | Global application stylesheet                      | `DESIGN.md`                        | Stable message-log gutter                                        | Computed styles and forced colors                         |
| Feedback       | App error/pending regions and scoped status text   | This contract                      | Error, pending, provider status                                  | Live regions and recovery                                 |
| CRUD           | `useWorkspace` plus owning screen                  | Core service and this contract     | Project enters workspace; catalog returns to list; settings stay | Complete flow and failure paths                           |

## Flow ledger

| Operation               | Pending                                                             | Success                                                           | Failure recovery                                                                   |
| ----------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Create/edit project     | Disable competing changes                                           | Open the project's workspace with saved context                   | Keep the form and its values                                                       |
| Add/edit catalog entry  | Disable competing changes                                           | Close editor and display saved entry                              | Keep editor, values, and inline validation                                         |
| Remove catalog entry    | Named app-owned confirmation; disable duplicate action              | Close dialog and refresh catalog/selections                       | Keep dialog open with an accessible error                                          |
| Save provider settings  | Disable competing changes                                           | Stay on Providers and announce saved status                       | Keep settings and focus invalid URL when applicable                                |
| Recommend MCPs & Skills | Shared cancellable pending state                                    | Display suggestions and reasons; explicit Apply changes selection | Preserve project brief and existing selections                                     |
| Start conversation      | Shared cancellable pending state while earlier chats are summarized | Select new conversation                                           | Preserve current conversation and draft                                            |
| Send message            | Stream response with Stop action                                    | Keep authoritative history and clear accepted draft               | Restore draft only when send was not accepted; accepted failures remain in history |
| Optimize conversation   | Shared cancellable pending state                                    | Show saved compact memory                                         | Retain existing history and summary                                                |
| Cancel/back/navigation  | Guard unsaved forms                                                 | Return to the selected destination                                | Keep editing when dialog is cancelled                                              |

## Validation and recovery

Forms declare `noValidate`. Required-field errors are text, expose `aria-invalid` and a real `aria-describedby` target, and focus the first invalid field. Core validation remains authoritative. User-entered project description, architecture, and rules are saved intact; summaries never overwrite them. Textarea lengths follow the core limits. Native selects are acceptable because the platform owns their popup appearance and interaction.

Dirty forms use the shared discard dialog for in-app navigation and a narrow `beforeunload` guard for real window unload. Chat drafts live in application memory by conversation and survive switching projects during the session; unsent drafts are not promised to survive restart. Persisted data is acknowledged only after the desktop service confirms it. Mutations are serialized, with duplicate submission blocked; streaming and background AI work offer cancellation. No automatic mutation retry or offline queue is promised.

## Navigation, feedback, and accessibility

Project chat is the default main surface when projects exist. Startup selects the first available project and its most recent conversation; a project without conversations shows the chat empty state with a way to begin. With no projects, the main surface shows the Projects empty state and a create action. Workspace management destinations—Projects, Catalog, and Providers—live in a collapsed sidebar disclosure. The project switcher has its own disclosure and New project action. New conversation and the selected project's chat history remain in the same sidebar, including while a management page is open. History lists the newest conversations first. Switching a project or selecting a conversation returns to that project's chat. Browsing management pages retains the selected project and each project's selected conversation for the current session. A separate inner conversation-list column is not used.

Sidebar disclosures retain native keyboard expansion and semantic summary behavior. Project and conversation selection have accessible current-state indicators. In-app navigation continues to guard dirty forms before changing destinations. Catalog filters are transient local state: this desktop workspace has no shareable web route contract. Catalog and project collections render the locally loaded data; no server pagination is implied. Keyboard focus is visible, controls remain semantic, and icon-only actions have accessible names. Native modal dialog behavior isolates background content and traps focus. Escape cancels a dismissible confirmation. Failed removal is explained inside its dialog; global failures stay visible until dismissed.

The chat log follows generation only when the reader is near the bottom. Switching conversations opens their latest messages. Ctrl/Cmd+Enter sends only outside IME composition; Enter otherwise inserts a newline. A saved response replaces its streaming row immediately, even when automatic memory work is still running. The memory status and Stop action stay available until that work finishes; prior assistant messages remain visible when a new send begins. Stop preserves any authoritative partial response and exposes its interrupted status. Catalog instructions are displayed as text; MCP execution is explicitly unavailable in this milestone.

## Verification

Run typecheck, lint, formatting, domain/provider tests, production build, and the strict premium UI audit. Keep static audit JSON under ignored `.tools/`; static inspection does not prove runtime behavior. Desktop verification covers default project/chat selection, no-project and no-conversation states, sidebar disclosure keyboard behavior, project switching, history selection, retained project context on management pages, project/catalog create-edit-cancel, removal confirmation/failure, provider connection failures, recommendations and explicit application, streaming/stop, summary failure, keyboard focus/IME, long content, a narrow viewport, reduced motion, and native select popup behavior. Project setup and catalog editing are the sibling form workflows used for consistency review.
