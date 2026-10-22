# MWIDE

**Easy MCP and Skill Management**

MWIDE is a desktop workspace for project-based prompts, conversations, MCP servers, and Skills. It preserves project purpose, architecture, and rules across chats, with user-controlled tool defaults and model recommendations.

Create projects, manage a personal MCP/Skill catalog, request model recommendations, and chat through Codex app-server or local Ollama. Conversations and automatic cross-chat memory are saved locally. Link a project folder to include a fresh file map and source declaration hints in new chats. MCP server execution and package installation are not enabled yet.

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

The chat composer offers the selected Codex model's supported reasoning efforts and displays the connected MWIDE Codex account's remaining usage windows and reset times. Unavailable account data is labeled explicitly. In a project's **Folder** tab, choose a directory with the native picker; its bounded read-only map refreshes before new chats and prompts. Ignored paths, common secrets, dependencies, build output, and links are omitted. The map supplies paths and approximate declarations, rather than a complete semantic code graph or file-editing access.

Built with Electron, React, TypeScript, and electron-vite in a single pnpm package.

- [Product scope](docs/product-scope.md)
- [Architecture](docs/architecture.md)
- [Development guidance](AGENTS.md)
