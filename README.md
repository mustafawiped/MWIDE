# MWIDE

**Easy MCP and Skill Management**

MWIDE is a desktop workspace for project-based prompts, conversations, MCP servers, and Skills. It preserves project purpose, architecture, and rules across chats, with user-controlled tool defaults and model recommendations.

The current milestone is the UI preview. Live ChatGPT through Codex app-server, local Ollama, persistence, and tool execution follow in backend milestones.

## Development

Requires Node.js **24.11+** and pnpm **11.25+**.

```sh
pnpm install
pnpm dev
```

```sh
pnpm check
pnpm build
```

No `.env` file or provider credentials are required for the UI preview.

Built with Electron, React, TypeScript, and electron-vite in a single pnpm package.

- [Product scope](docs/product-scope.md)
- [Architecture](docs/architecture.md)
- [Development guidance](AGENTS.md)
