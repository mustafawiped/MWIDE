# MWIDE

**Easy MCP and Skill Management**

MWIDE is a desktop workspace for project-based prompts, conversations, MCP servers, and Skills. It preserves project purpose, architecture, and rules across chats, with user-controlled tool defaults and model recommendations.

Create projects, manage a personal MCP/Skill catalog, request model recommendations, and chat through Codex app-server or local Ollama. Conversations and automatic cross-chat memory are saved locally. Link a project folder to include a persistent code index in chats. MCP server execution and package installation are not enabled yet.

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

For repeatable context and long-chat performance experiments, run `pnpm benchmark` after building. Reports stay in `.mwide/benchmarks/`. See [performance measurements and limits](docs/performance.md).

Run `pnpm benchmark:codegraph` for the isolated TypeScript/JavaScript comparison against an installed Codebase Memory executable. Set `MWIDE_REFERENCE_BINARY` or put it on PATH. See the [measured scope and results](docs/codegraph-benchmark.md).

In **Providers**, connect ChatGPT through an installed native Codex CLI, or check a running local Ollama service. Select a model and save your default provider. MWIDE keeps a separate Codex sign-in profile; no API key is required.

The chat composer offers the selected Codex model's supported reasoning efforts and displays the connected MWIDE Codex account's remaining usage windows and reset times. Unavailable account data is labeled explicitly. In a project's **Folder** tab, choose a directory with the native picker and save it. **Code index** shows symbols, statically resolved callers/callees, change counts and coverage limits. TypeScript/JavaScript declarations and relative imports are parsed with the TypeScript AST and persisted in a private SQLite cache. Refreshes reuse unchanged extraction, remove deleted symbols, and relink changed dependencies before chats and prompts. Relevant evidence fits a bounded prompt budget; source bodies and file-editing access are not supplied. Ignored paths, common secrets, dependencies, build output, and links are omitted. Other languages retain paths with an unsupported-language notice.

Built with Electron, React, TypeScript, and electron-vite in a single pnpm package.

- [Product scope](docs/product-scope.md)
- [Architecture](docs/architecture.md)
- [Code graph design and reference](docs/codegraph-design.md)
- [Development guidance](AGENTS.md)
