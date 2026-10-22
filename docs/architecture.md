# Architecture

MWIDE uses Electron, React, TypeScript, electron-vite, and pnpm in one package. Keep responsibilities focused and introduce abstractions at concrete integration boundaries.

## Module boundaries

| Location        | Responsibility                                                             |
| --------------- | -------------------------------------------------------------------------- |
| `src/main`      | Desktop lifecycle, atomic local storage, validated IPC, provider processes |
| `src/preload`   | Explicit, typed workspace operations and event subscriptions               |
| `src/renderer`  | Project, catalog, provider, and conversation interfaces                    |
| `src/shared`    | Workspace records and bridge contracts                                     |
| `src/core`      | Validation, project context, summaries, and workspace coordination         |
| `src/providers` | Independent Codex app-server and Ollama adapters                           |

The core depends on small repository and model-provider contracts. It does not import Electron or React. The renderer cannot access Node, credentials, arbitrary files, or a shell. IPC accepts only the application's main frame and a fixed set of operations.

## Storage and continuity

The versioned workspace file lives in Electron's application data directory. Writes are serialized, validated, flushed to a temporary file, then atomically renamed. Memory changes only after a successful write. Invalid files are preserved and reported; startup never silently resets them. This first release uses JSON to keep the storage boundary small. A future database must preserve the same repository behavior and provide explicit migrations.

Project purpose, architecture notes, and additional rules are canonical records. Every model request receives them in full, separately from generated conversation summaries. Only an explicit project edit changes them. Unknown architecture is marked as undecided.

Full messages remain stored after summarization. Summaries contain at most 1,600 characters; invalid output never advances the summary boundary. New conversations summarize earlier project chats before creation. Requests include the other chats' summaries and any unsummarized tails, with no information from other projects. Long active conversations compact earlier messages in bounded batches while keeping recent message pairs. Oversized provider context produces an error rather than silently cutting canonical fields.

One model operation runs at a time. Accepted user messages are saved with an interrupted assistant placeholder before generation. Completed, failed, and cancelled responses have distinct terminal states, so retrying does not duplicate accepted user messages. Cancellation before acceptance preserves the draft.

## Provider adapters

Codex runs as a native child process with an isolated MWIDE profile and workspace. The adapter initializes app-server, checks its tool policy, discovers models, creates ephemeral threads, injects MWIDE history, and streams turns. The current protocol fixtures target `0.163.0-alpha.11`. Existing Codex credentials are not copied. Only ChatGPT accounts are accepted; there is no silent API-billing fallback. Each request uses MWIDE's saved context instead of relying on a provider-owned chat history.

Ollama uses local HTTP at `localhost`, `127.0.0.1`, or `::1`. Its adapter discovers local completion models, checks model context metadata, streams NDJSON, and propagates cancellation and connection errors. Cloud models and unexpected tool calls are rejected.

Both adapters provide text conversations in this milestone. Codex tools, web search, and MCP servers are disabled; selected Skills contribute instructions and MCP entries contribute references. Model recommendations can only reference existing catalog entries. Users review and apply suggestions explicitly.

## Validation

Run type, lint, format, behavior-test, and production-build checks before committing. Provider fixtures cover protocol failures, cancellation, tool denial, authentication isolation, streaming, and context limits. Inspect the real desktop flow as well as provider fixtures. Describe real account and local-model checks separately from mocked integration coverage.

Documentation and UI copy stay in English. Credentials, local workspace records, generated test profiles, and model downloads never belong in Git.
