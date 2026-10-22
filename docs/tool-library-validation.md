# Tool library validation

Verified on Windows on 2026-10-23 with Node.js 24.11.1 and Electron 45.0.0. This records an actual MWIDE-profile installation and protocol discovery checks, rather than research recipes alone.

## Installation

- 70 complete Skills: 400 resource files, with source hashes and upstream licenses retained.
- 19 local MCP runtimes: 13 npm packages, 5 isolated Python environments and one verified existing Codebase Memory executable.
- 11 official remote MCP endpoints registered. Remote registration does not install a server binary or authorize an account.
- 100 entries imported into the existing profile. Existing settings, projects, conversations and personal catalog entries were compared before and after import and preserved.
- No installation errors remained after the reviewed Serena dependency fix. The installer reports 81 installed entries and 19 needing account or project setup.

## Real protocol checks

All 18 servers that can be inspected without account credentials completed MCP negotiation and bounded tool enumeration. Seven of these checks used a dedicated project-folder fixture. Each session was closed after discovery; no tools were invoked. The 12 account-dependent servers were left requiring setup and were not reported as connected.

| Server                 | Version                         | Listed tools |
| ---------------------- | ------------------------------- | ------------ |
| Playwright             | 0.0.83                          | 25           |
| Chrome DevTools        | 1.12.0                          | 32           |
| Filesystem             | 2.0.0                           | 14           |
| Knowledge Graph Memory | 2.0.0                           | 9            |
| Sequential Thinking    | 2.0.0                           | 1            |
| Next.js DevTools       | 0.4.0                           | 4            |
| shadcn/ui              | 4.22.1                          | 7            |
| Svelte                 | 0.1.27                          | 4            |
| Angular CLI            | 21.2.28                         | 6            |
| Context7               | 4.4.4                           | 2            |
| Fetch                  | 2026.10.19                      | 1            |
| Git                    | 2026.10.19                      | 12           |
| AWS IaC                | 1.0.26                          | 9            |
| Codebase Memory        | 0.11.0                          | 17           |
| Microsoft Learn        | Hosted service (vendor updated) | 3            |
| DeepWiki               | Hosted service (vendor updated) | 3            |
| AWS Knowledge          | Hosted service (vendor updated) | 5            |
| Serena                 | 2.1.0                           | 3            |

Playwright was additionally checked through the running production Electron main process and its real preload bridge in the existing profile; it returned 25 tools. Cold Python/Node startup initially timed out on Context7 and Serena; subsequent checks passed after dependencies and startup caches were available. A successful capability check does not establish that browser binaries, language servers, remote credentials or every tool action work.

## Regression coverage

- `pnpm check`, `pnpm test` (206 passing tests), and `pnpm build` passed. The 18 focused library/inspector tests are included in that total.
- `pnpm test:desktop` passed the existing project, folder, chat, streaming, cancellation, continuity, provider-control and responsive-layout flows.
- `pnpm test:library` used the production main/preload/renderer with an isolated profile, all 100 definitions and all 400 Skill resources. It verified idempotent import, unchanged personal records and project selections, complete 44,239-character source instructions, read-only reviewed entries, and library/detail layouts at 1280×800 and 640×480.
- Inspector tests cover capability pagination, response bounds, cancellation and child exit, no tool invocation, no inherited provider secrets, rejected changed entry points, ignored forged commands, and rejected forged arguments. Resource tests cover descriptor hard links, redirected directories and source integrity.
- The reviewed `proxy_tools` compatibility wheel was installed offline into an isolated target; package metadata and every RECORD hash/size were checked. Upstream build scripts and package code were not executed during wheel preparation.

## Product boundary

Selected Skills supply instructions to chat. Supporting scripts are installed as files. MCP servers support explicit connection discovery; model-driven tool invocation, account authorization and persistent project-scoped sessions are not implemented in this milestone. Sources, versions, licenses and setup requirements are listed in the [reviewed library](tool-library.md).

Local installation logs, package locks, profile data, capability reports and screenshots stay outside version control.
