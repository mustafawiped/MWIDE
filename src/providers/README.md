# Providers

ChatGPT uses the Codex app-server engine as a local child process. Ollama is an independent local provider. MWIDE owns projects, conversations, protected project context, and MCP/Skill selections.

The Codex adapter will handle initialization, threads, turns, streaming, cancellation, and resume. Engine choice is separate from authentication: eligible ChatGPT plan usage, API-key billing, and local-server access are distinct routes.

Live connections follow the UI preview milestone. Keep credentials outside the renderer, expose supported capabilities explicitly, and define protocol pinning, token renewal, and recovery during integration.
