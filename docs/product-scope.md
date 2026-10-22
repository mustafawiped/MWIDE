# Product scope

MWIDE — **Easy MCP and Skill Management**

MWIDE is a project-based prompt and conversation workspace with a personal MCP and Skill catalog. Projects can cover software, research, writing, or another topic.

## Implemented workflows

- Create and edit projects with a name, complete purpose, additional rules, architecture notes, and catalog selections.
- Maintain reusable Skill instructions and MCP references. Request recommendations from the default model, inspect the reasons, then apply the desired suggestions.
- Configure ChatGPT through Codex app-server or a local Ollama service, discover models, and choose the default provider.
- Stream, stop, and save conversations. Start additional chats with short memories from earlier chats in the same project.
- Inspect and manually optimize conversation memory. Automatic compaction preserves full stored history and keeps complete project context separate.

Purpose, architecture, and rules are never replaced by summaries. The user changes canonical records through project editing. Model output cannot silently install packages, start servers, or grant permissions.

## Next milestones

Add actual MCP server configuration, lifecycle, and permissions; import Skills from explicit sources; then add project-folder access and deliberate approval flows for development actions. Show sources, versions, requested access, and project scope before installation or execution.

Later work may include a context-pressure prompt to continue in a new chat and a project memory index. The current release compacts the active conversation and lets users create a new one explicitly. Evaluate summary quality with realistic long projects before making stronger continuity guarantees.

## Delivery

Design each interaction before connecting its backend. Verify behavior, inspect the desktop flow, then commit and push the completed section. Keep documentation in English and the README concise. A full editor, IDE extension ecosystem, cloud sync, and autonomous repository restructuring are outside the first release.
