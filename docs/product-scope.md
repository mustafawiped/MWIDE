# Product scope

MWIDE — **Easy MCP and Skill Management**

MWIDE is a project-based prompt and conversation workspace with a personal MCP and Skill catalog. Projects can cover software, research, writing, or another topic.

## Implemented workflows

- Create and edit projects with a name, complete purpose, additional rules, architecture notes, and catalog selections.
- Maintain reusable Skill instructions and MCP references. Request recommendations from the default model, inspect the reasons, then apply the desired suggestions.
- Install the reviewed 70-Skill, 30-MCP library into an MWIDE profile, retain upstream licenses and supporting files, inspect source/version/access requirements, and import installed entries without changing project selections. Explicit MCP connection checks negotiate the protocol and list bounded capabilities, then close the session.
- Configure ChatGPT through Codex app-server or a local Ollama service, discover models, and choose the default provider.
- Stream, stop, and save conversations. Open additional chats without an AI request, retaining exact short histories and compact memories from earlier chats in the same project.
- Optimize conversation memory automatically while preserving full stored history and complete canonical project context. There is no manual optimization setting.
- Choose the selected Codex model's supported reasoning effort in the chat composer. Read remaining usage windows and reset times from the ChatGPT account signed in to MWIDE's Codex profile.
- Bind a local project folder through the native picker. Persist TypeScript/JavaScript AST symbols and statically resolved calls/imports in a private SQLite index. Refresh metadata before new chats and prompts, reuse unchanged extraction, and remove stale relationships after changes. Retrieve relevant bounded evidence for chat. Inspect paged symbols and calls in Code index; coverage and unresolved counts remain explicit. Other languages retain filenames only.
- Keep long-chat rendering and streamed view updates bounded. Load earlier messages inside the chat scroller and scan linked folders in a cancellable background worker.

Purpose, architecture, and rules are never replaced by summaries. The user changes canonical records through project editing. Model output cannot silently install packages, start servers, or grant permissions.

## Next milestones

Add user-configured MCP accounts, persistent server lifecycle, project permissions and AI tool invocation; extend Skill imports beyond the reviewed pack; then add deliberate approval flows for development actions. The current library supplies Skill instructions and MCP references to chat; it does not invoke MCP tools through the model or execute supporting Skill scripts. The code index currently supplies structural evidence with explicit unresolved calls, rather than complete runtime dispatch, complete source retrieval or write access. Type checking, external packages, path aliases, dynamic dispatch and additional language adapters need separate milestones.

Later work may include a context-pressure prompt to continue in a new chat and a project memory index. The current release compacts the active conversation and lets users create a new one explicitly. Evaluate summary quality with realistic long projects before making stronger continuity guarantees.

## Delivery

Design each interaction before connecting its backend. Verify behavior, inspect the desktop flow, then commit and push the completed section. Keep documentation in English and the README concise. A full editor, IDE extension ecosystem, cloud sync, and autonomous repository restructuring are outside the first release.
