# Changelog

## Unreleased

- Added a persistent TypeScript/JavaScript AST code graph with static call/import resolution, incremental extraction, atomic SQLite generations, and cancellation recovery.
- Added project Code index search and caller/callee inspection, with source locations, change counts, and explicit coverage limits.
- Connected query-focused code evidence to chat and published a five-sample comparison against Codebase Memory 0.11.0 fast mode.
- Reduced long-chat rendering with memoized messages, earlier-history paging, and lossless stream batching.
- Removed unnecessary AI summary calls on short chat handoffs; compact larger archives when the actual model budget requires it.
- Moved project-folder scanning to a reusable, cancellable background worker.
- Added repeatable context and desktop performance experiments against `v1.1.0`, including late-reply, cancellation, draft, and scroll-position checks.

## 1.1.0 — 2026-10-22

- Added a chat-first monochrome interface with project selection, conversation history, and collapsible workspace navigation.
- Made the desktop layout adapt to the window, keeping the composer visible and content scrolling within chat and the sidebar.
- Added direct prompts, streamed replies, cancellation, and model selection for Codex and local Ollama.
- Added the selected Codex model's supported reasoning efforts and the connected account's remaining usage limits and reset times.
- Made conversation memory optimization automatic while preserving full history and canonical project context.
- Added native project-folder selection and a read-only file map that refreshes before new chats and prompts. Bounded declaration and import hints provide structural context; this is not a complete semantic code graph.

MCP server execution and package installation remain unavailable.

## 1.0.0 — 2026-10-22

- Initial versioned release.
