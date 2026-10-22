# MWIDE development guidance

## Product

- Name: MWIDE. Keep the tagline exactly `Easy MCP and Skill Management`.
- Build a project-based prompt/chat environment with MCP and Skill management, not a full IDE.
- Initial providers: ChatGPT through the Codex app-server engine, and local LLMs starting with Ollama.
- Project creation will include explicit MCP/Skill selection and relevant recommendations.
- Read `docs/product-scope.md` before expanding scope. This baseline contains no live integrations.

## Implementation

- Use TypeScript, Electron, React, electron-vite and pnpm. Prefer simple modules over speculative abstractions.
- Keep domain behavior independent of Electron, React and provider-specific sessions.
- Renderer has no Node, filesystem, credential or general-purpose IPC access. Extend only the narrow typed preload bridge when needed.
- Preserve context isolation and renderer sandboxing. Never expose arbitrary shell execution.
- Suggestions do not authorize installation or execution. Respect project-scoped user choices.
- Never commit tokens, `.env` files, local project data or model downloads.
- For structural codebase exploration, use the installed `codebase-memory` skill when available; otherwise use targeted source reads.

## Validation

- Run `pnpm check` and `pnpm build` for implementation changes.
- Add behavior tests when actual product behavior is introduced. Avoid tests that merely mirror static starter content.
- Keep the lockfile committed. Do not claim a provider is connected until a real end-to-end integration is verified.
