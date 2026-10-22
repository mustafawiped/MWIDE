# Providers

ChatGPT uses the Codex app-server engine as a local child process. Ollama is an independent local provider. MWIDE owns projects, conversations, protected project context, and MCP/Skill selections.

The Codex adapter owns an isolated sign-in profile and ephemeral threads. It supplies MWIDE history, streams text, handles cancellation, and rejects tool requests. API-key accounts are not used. The protocol fixtures target Codex `0.163.0-alpha.11`; other installed versions must pass the capability checks before use.

Ollama uses a loopback HTTP connection, local completion models, streamed responses, and cancellation. Context budgets reject oversized requests without truncating protected project fields. Credentials and network/process access remain outside the renderer.
