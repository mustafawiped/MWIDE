# Product scope

MWIDE — **Easy MCP and Skill Management**

MWIDE is a project-based prompt and conversation workspace with MCP and Skill management. A project can cover software, research, writing, or another topic. The product focuses on project continuity and a clear setup for models and tools.

## Current milestone

Build and review the UI preview first: project setup, conversation layout, context visibility, provider selection, and MCP/Skill management screens. These screens establish the intended interactions. Live model responses, durable storage, installation, and tool execution belong to subsequent backend milestones.

## Project setup

Each project has:

- A name and a complete description of its purpose
- Additional user rules
- Canonical architecture notes
- Conversations associated with that project
- Selected MCP servers and Skills, including user-defined defaults

The complete purpose, architecture notes, and additional rules remain separate from chat summaries. A short summary must not replace, silently shorten, or rewrite these canonical records. Users change them through explicit project editing.

## Conversations and continuity

Users can start multiple chats within the same project. New chats receive the protected project context and short summaries of relevant earlier chats. Summaries capture decisions, current work, unresolved questions, and next steps. Full conversation history remains available separately once persistence is implemented.

The interface should distinguish the complete project context from a generated summary, so users can inspect and correct the information carried forward. Summarization must preserve the meaning of user decisions and rules.

## MCP and Skill choices

Users define their default MCP servers and Skills and choose which apply to a project. A dedicated recommendation button asks the selected model for suggestions based on the project's purpose, architecture, rules, and current selections.

Recommendations supplement the user's choices. They do not silently change defaults, install packages, start servers, or run Skills. Users review the source and required access, then explicitly choose any installation or execution action. Project permissions do not transfer automatically to another project.

## Model connections

**ChatGPT through Codex app-server:** Codex app-server is the selected engine and will run as a local child process. MWIDE owns projects, conversations, context records, and catalog choices. The adapter will handle sessions, turns, streaming, cancellation, and resume. [Codex app-server](https://learn.chatgpt.com/docs/app-server)

**ChatGPT authentication:** Engine selection and account authorization are separate decisions. Sign in with ChatGPT is the target plan-usage route where distribution and accounts are eligible. It does not import existing ChatGPT conversations. Paid or hosted distribution requires its own scope review. API-key access, if added, has separate API billing and must be an explicit choice. [OpenAI integration scope](https://developers.openai.com/siwc/token-sharing-open-source)

**Local Ollama:** Ollama is the first independent local provider. Its connection, model selection, streaming, cancellation, and errors will be implemented through a separate adapter. [Ollama API](https://docs.ollama.com/api/introduction)

LM Studio's OpenAI-compatible server and Claude are later options. [LM Studio API](https://lmstudio.ai/docs/developer/openai-compat)

## Delivery order

1. Implement and inspect the UI preview with realistic interaction states.
2. Add project storage and protected purpose, architecture, and rules.
3. Connect actual ChatGPT through Codex app-server and local Ollama.
4. Implement user defaults, explicit model recommendations, and authorized MCP/Skill management.
5. Add cross-chat summaries and verify that complete project context is preserved.

Test, review, commit, and push each completed milestone. Keep the first release focused; a full code editor, IDE extension ecosystem, cloud sync, and autonomous repository restructuring are outside this scope.
