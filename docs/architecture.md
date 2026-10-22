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

Full messages remain stored after summarization. Summaries contain at most 1,600 characters; invalid output never advances the summary boundary. New conversations open without a model request. Short project histories remain verbatim; requests include every other same-project chat's summary and uncovered tail. Under context pressure, larger archived tails are compacted first, preserving recent active message pairs when possible. Long active conversations also receive automatic maintenance at the message/size threshold. Oversized provider context produces an error rather than silently cutting canonical fields.

Memory optimization has no renderer command or user setting. Prompt preflight estimates the provider's conservative context budget and automatically compacts older history when needed. Summary requests use the same budget; oversized archived messages are split into ordered Unicode-safe fragments, with each original pair's new summary committed only after all its fragments succeed. The local provider reports its model context budget with template and output headroom. Prompt and canonical context that still cannot fit fail before accepting the user message.

Project folder bindings are optional fields compatible with existing workspace files. The native picker resolves a canonical directory; IPC accepts only a picker-granted path or a path already bound to a saved project. An owned background worker refreshes metadata before conversation creation, prompts and index queries. One worker is reused with a 256 MiB old-generation ceiling and one pending operation; overlapping requests fail explicitly. Cancellation terminates the worker; SQLite transactions retain the last complete generation. Later requests create a replacement and reuse persisted extraction.

The code graph separates safe traversal (`codegraph-files`), TypeScript AST extraction (`codegraph-parser`), static resolution (`codegraph-linker`), SQLite persistence/retrieval (`codegraph-store`), and worker transport (`folder-index`). Each canonical project root has a schema-versioned database in the application's private `code-index` directory. Nanosecond metadata fingerprints include identity, size, mtime, ctime and link count. Matching files reuse extraction without reading source bodies; changed metadata triggers hashing and parsing only when content changes. Deleted/excluded files lose their symbols; all supported calls are relinked after graph changes so unchanged importers cannot retain removed targets. A successful transaction publishes records, edges and status together. Corrupt or incompatible caches are preserved with an actionable error.

Traversal rejects redirected roots, links and multiply-linked files; honors bounded nested `.gitignore` rules; and omits common secrets, dependencies and build output. Limits include 10,000 files, 50,000 directory entries, depth 32, 256 KiB per source file, 32 MiB source reads per refresh, 100,000 symbols and 250,000 calls. Unsupported languages retain paths with coverage reasons. TypeScript/JavaScript calls resolve lexical bindings, relative imports, aliases, barrels and supported class receivers. External packages, configured path aliases, dynamic receivers and type-based dispatch remain unresolved. No project compiler configuration or source code is executed.

The renderer can inspect or query only a saved project ID. Main resolves its folder; the bridge accepts bounded literal searches and call traces, with no SQL, shell or arbitrary path operation. Code index pages expose symbols, source lines, changes and coverage. Prompt retrieval prioritizes symbols matching the current question and nearby static relationships, then fills a bounded overview. The JSON evidence uses at most 18,000 UTF-8 bytes, reduced for smaller models, and explicitly treats paths/names as untrusted data. Full source bodies are neither persisted nor included. Evidence stays separate from saved messages and canonical project fields.

One model operation runs at a time. Accepted user messages are saved with an interrupted assistant placeholder before generation. Completed, failed, and cancelled responses have distinct terminal states, so retrying does not duplicate accepted user messages. Cancellation before acceptance preserves the draft.

Stream transport sends the first delta immediately, then coalesces bursts for at most 32 ms or 4,096 characters. Saved-state and error events flush preceding text before delivery. Each delta identifies its saved assistant reply; the renderer rejects previous reply IDs and batches view updates per animation frame with a 32 ms fallback. Completion, cancellation, and unmount clear queued work. Saved Markdown rows use scalar memoized props. The chat initially mounts its latest 60 messages, with earlier pages loaded inside the existing chat scroller while preserving the viewport anchor. View paging does not change stored history or model context.

## Provider adapters

Codex runs as a native child process with an isolated MWIDE profile and workspace. The adapter initializes app-server, checks its tool policy, discovers models, creates ephemeral threads, injects MWIDE history, and streams turns. The current protocol fixtures target `0.163.0-alpha.11`. Existing Codex credentials are not copied. Only ChatGPT accounts are accepted; there is no silent API-billing fallback. Each request uses MWIDE's saved context instead of relying on a provider-owned chat history.

Codex model discovery retains `supportedReasoningEfforts` and the default effort. An explicit effort is validated for the selected model and passed through `turn/start`; model default omits the override. Usage reads call `account/rateLimits/read` on the same isolated MWIDE profile, prefer the multi-bucket response, and convert consumed percentages to clamped remaining percentages. Unknown windows and reset metadata stay unavailable. The composer refreshes limits while idle, after replies, and when returning to the window, showing a timestamp on stale data. These are read-only operations; they never consume resets or credits. Protocol reference: [official OpenAI app-server documentation](https://learn.chatgpt.com/docs/app-server).

Ollama uses local HTTP at `localhost`, `127.0.0.1`, or `::1`. Its adapter discovers local completion models, checks model context metadata, streams NDJSON, and propagates cancellation and connection errors. Cloud models and unexpected tool calls are rejected.

Both adapters provide text conversations in this milestone. Codex tools, web search, and MCP servers are disabled; selected Skills contribute instructions and MCP entries contribute references. Model recommendations can only reference existing catalog entries. Users review and apply suggestions explicitly.

## Validation

Run type, lint, format, behavior-test, and production-build checks before committing. Provider fixtures cover protocol failures, cancellation, tool denial, authentication isolation, streaming, and context limits. Inspect the real desktop flow as well as provider fixtures. Describe real account and local-model checks separately from mocked integration coverage.

Use the repeatable [performance experiments](performance.md) to compare operation counts, encoded input bytes, mounted history, and actual desktop stream delivery against a frozen baseline. Fixture fact retention does not establish general model quality or competitive superiority.

Documentation and UI copy stay in English. Credentials, local workspace records, generated test profiles, and model downloads never belong in Git.
