# MWIDE

**Easy MCP and Skill Management**

MWIDE is a desktop workspace for project-based prompts, conversations, MCP servers, and Skills. It preserves project purpose, architecture, and rules across chats, with user-controlled tool defaults and model recommendations.

Create projects, manage a personal MCP/Skill catalog, request model recommendations, and chat through Codex app-server or local Ollama. Conversations and compact cross-chat memory are saved locally. MCP server execution and package installation are not enabled yet.

## Development

Requires Node.js **24.11+** and pnpm **11.25+**.

```sh
pnpm install
pnpm dev
```

```sh
pnpm check
pnpm test
pnpm build
pnpm test:desktop
```

In **Providers**, connect ChatGPT through an installed native Codex CLI, or check a running local Ollama service. Select a model and save your default provider. MWIDE keeps a separate Codex sign-in profile; no API key is required.

Built with Electron, React, TypeScript, and electron-vite in a single pnpm package.

- [Product scope](docs/product-scope.md)
- [Architecture](docs/architecture.md)
- [Development guidance](AGENTS.md)
