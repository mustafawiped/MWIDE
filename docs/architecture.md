# Architecture

MWIDE uses Electron, React, TypeScript, electron-vite, and pnpm in a single package. UI work comes first; backend behavior is added in small, tested milestones. Apply SOLID through clear responsibilities and narrow boundaries, with minimal boilerplate.

## Module boundaries

| Location        | Responsibility                                                                |
| --------------- | ----------------------------------------------------------------------------- |
| `src/main`      | Electron lifecycle, windows, and privileged desktop operations                |
| `src/preload`   | Narrow, typed bridge available to the renderer                                |
| `src/renderer`  | Project, conversation, context, provider, and tool-management screens         |
| `src/shared`    | Data and communication contracts shared across processes                      |
| `src/core`      | Provider-independent project, conversation, context, and selection rules      |
| `src/providers` | Codex app-server and independent Ollama adapters                              |
| `src/catalog`   | MCP/Skill definitions, user defaults, project selections, and recommendations |

These are modules within one application. Add abstractions when a concrete behavior or integration needs a boundary.

## Process boundary

The renderer has no direct filesystem, credential, or arbitrary shell access. Desktop operations use the typed preload bridge and validated main-process handlers. Domain behavior stays independent of Electron, React, and provider-specific session formats.

Codex app-server will run as a local child process. Ollama will use its own local server connection. Credentials and process management stay outside the renderer. The current screen milestone does not implement these live connections or tool execution.

## Project context

The core distinguishes three kinds of information:

- **Canonical project records:** name, complete purpose, architecture notes, and additional user rules
- **Conversation records:** full messages and relevant provider session references
- **Continuity summaries:** short generated handoffs containing decisions, progress, questions, and next steps

Summaries refer to canonical records; they must not replace or silently edit them. Starting a new chat preserves complete purpose and architecture. Explicit project edits update canonical records separately from summarization. MWIDE owns its project and conversation identifiers; provider session identifiers are linked references.

Durable storage is a backend milestone. SQLite remains the planned local store; its schema and migrations should follow actual project and conversation workflows.

## Provider adapters

The Codex app-server adapter will own initialization, threads, turns, streamed events, cancellation, and resume. The initial protocol flow includes `initialize`, `thread/start`, and `turn/start`. Pin the supported runtime/protocol version and define recovery and token renewal during integration. [Codex app-server](https://learn.chatgpt.com/docs/app-server)

Engine selection does not itself authorize ChatGPT plan usage. The authentication layer will handle the supported Sign in with ChatGPT flow for eligible distribution and accounts. API-key access has separate billing. Show the active account and payment source, and never switch silently to API billing. [OpenAI scope](https://developers.openai.com/siwc/token-sharing-open-source), [SIWC with app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

MWIDE maintains its own conversation history and supplies supported context to providers. Account authorization does not import ChatGPT history, and preview API limitations must be respected. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

The independent Ollama adapter will handle local endpoint configuration, model selection, streaming, cancellation, and connection errors. LM Studio can later use a separate OpenAI-compatible adapter. Provider capabilities should be explicit rather than assumed identical.

## Catalog and recommendations

Keep metadata, user defaults, project selections, generated recommendations, installation, and execution as distinct states. A user presses a recommendation button to send relevant project context to the selected model. Display suggestions without modifying defaults or granting permissions.

Installing or running an MCP server or Skill requires a separate authorized action. Show its source, version, requested access, and project scope. Future MCP child processes need lifecycle, cancellation, timeout, and permission-revocation handling. Skill content cannot grant itself broader permissions.

## Milestone validation

Develop the visible interaction first, then connect its backend and verify the complete flow. Run type, lint, format, behavior-test, and build checks appropriate to the milestone. Inspect desktop screens and error states. Commit and push tested milestones with an accurate description of implemented behavior.

Keep documentation and in-app reports in English. Never commit credentials, local project data, or model downloads. Do not present a provider as connected until its real end-to-end flow has been verified.
