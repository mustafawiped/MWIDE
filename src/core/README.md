# Application core

Provider-independent rules for projects, conversations, user defaults, and project-specific MCP/Skill selections belong here. Keep this module independent of Electron, React, and provider session formats.

Preserve complete project purpose, canonical architecture notes, and additional rules separately from generated cross-chat summaries. Summarization must not silently edit or replace canonical records.

`WorkspaceService` coordinates durable changes and model operations through narrow repository and provider contracts. `memory.ts` builds complete project context and validates compact summaries; `validation.ts` validates incoming and saved records.
