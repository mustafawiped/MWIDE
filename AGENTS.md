# MWIDE development guidance

## Product

- Name: MWIDE. Keep the tagline exactly `Easy MCP and Skill Management`.
- Build a project-based prompt/chat environment with MCP and Skill management.
- Initial providers: ChatGPT through Codex app-server, and independent local Ollama.
- Projects include a name, complete purpose, additional rules, and canonical architecture notes.
- Keep complete purpose and architecture separate from short cross-chat summaries. Summarization must not silently rewrite protected project records.
- Support user-defined default MCP servers and Skills. Model recommendations run only when the user presses an explicit recommendation button.
- Read `docs/product-scope.md` before expanding scope. The current phase is the UI preview; live backend integrations follow.

## Implementation

- Use TypeScript, Electron, React, electron-vite and pnpm. Apply SOLID through focused responsibilities and narrow boundaries, with minimal boilerplate.
- Keep domain behavior independent of Electron, React and provider-specific sessions.
- Renderer has no Node, filesystem, credential or general-purpose IPC access. Extend only the narrow typed preload bridge when needed.
- Preserve context isolation and renderer sandboxing. Never expose arbitrary shell execution.
- Suggestions do not authorize installation or execution. Respect project-scoped user choices.
- Never commit tokens, `.env` files, local project data or model downloads.
- For structural codebase exploration, use the installed `codebase-memory` skill when available; otherwise use targeted source reads.
- Keep informational documentation, in-app copy, and in-app reports in English.

## Workflow

- Implement and inspect the UI for each flow before connecting its backend.
- Deliver small, testable milestones. Verify behavior, then commit and push each completed milestone.
- Distinguish implemented behavior from previews and planned work in documentation and reports.

## Validation

- Run `pnpm check` and `pnpm build` for implementation changes.
- Add and run behavior tests as actual product behavior is introduced. Avoid tests that merely mirror static content.
- Keep the lockfile committed. Do not claim a provider is connected until a real end-to-end integration is verified.
