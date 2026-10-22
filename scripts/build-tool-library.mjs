import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { format, resolveConfig } from 'prettier'

const root = resolve(import.meta.dirname, '..')
const formatting = await resolveConfig(join(root, 'resources/tool-library-pack.json'))
const skills = JSON.parse(
  await readFile(join(root, 'data/research/skills-candidates.json'), 'utf8'),
)
const mcps = JSON.parse(await readFile(join(root, 'data/research/mcp-candidates.json'), 'utf8'))
const entries = []
for (const skill of skills.skills) {
  const files = []
  for (const file of skill.files) {
    const data = await readFile(join(root, skill.stagingDirectory, file.path))
    if (createHash('sha256').update(data).digest('hex') !== file.sha256)
      throw Error(`Skill integrity mismatch: ${skill.id}/${file.path}`)
    files.push({ path: file.path, sha256: file.sha256, data: data.toString('base64') })
  }
  entries.push({
    entry: {
      id: skill.id,
      kind: 'skill',
      name: skill.name,
      description: skill.description,
      category: skill.category,
      tags: skill.tags,
      coding: skill.coding,
      version: skill.source.commit.slice(0, 12),
      source: {
        url: skill.source.url,
        repository: skill.source.repository,
        revision: skill.source.commit,
        license: skill.source.license,
      },
      state: 'available',
      detail: 'Reviewed Skill instructions and resources. Scripts remain inactive.',
      requirements: skill.dependencies.tools ?? [],
      access: [
        'Selected project prompt instructions',
        'Supporting scripts are installed as files and are not executed by chat.',
      ],
    },
    files,
  })
}
for (const candidate of mcps.entries) {
  const pkg = candidate.package
  const source = candidate.source
  let args = candidate.config.args ?? []
  if (pkg?.registry === 'npm') args = args.slice(1)
  if (pkg?.registry === 'pypi') args = args.slice(5)
  const environment = Object.fromEntries(
    Object.entries(candidate.config.env ?? {}).map(([key, value]) => [
      key,
      value.replaceAll('${managedData}', '${dataDirectory}'),
    ]),
  )
  if (candidate.id === 'angular') environment.NG_CLI_ANALYTICS = 'false'
  const config = {
    transport: candidate.transport === 'stdio' ? 'stdio' : 'http',
    args,
    environment,
    requiresProject: candidate.requiresProject,
    requiresSetup: candidate.auth.required,
  }
  if (config.transport === 'http') config.url = candidate.config.url
  if (pkg?.registry === 'npm')
    config.package = { name: pkg.name, version: pkg.version, bin: pkg.entrypoint }
  if (pkg?.registry === 'pypi')
    config.python = { name: pkg.name, version: pkg.version, module: pkg.entrypoint }
  if (pkg?.registry === 'native-existing')
    config.native = { name: pkg.executable, sha256: pkg.sha256 }
  entries.push({
    entry: {
      id: candidate.id,
      kind: 'mcp',
      name: candidate.name,
      description: candidate.description,
      category: candidate.tags.find((tag) => tag !== 'coding') ?? 'development',
      tags: candidate.tags,
      coding: true,
      version: pkg?.version ?? 'Hosted service (vendor updated)',
      source: {
        url: source.docs,
        repository: source.repository,
        revision: source.referenceCommit ?? 'hosted-service',
        license: source.license,
      },
      state: 'available',
      detail: 'Reviewed MCP configuration. Not installed or connected yet.',
      requirements: [
        ...(candidate.auth.required ? [candidate.auth.description] : []),
        ...candidate.setup,
      ],
      access: candidate.access,
    },
    mcp: config,
  })
}
if (entries.length !== 100 || new Set(entries.map(({ entry }) => entry.id)).size !== 100)
  throw Error('Expected exactly 100 distinct reviewed entries.')
const revision = createHash('sha256')
  .update(
    JSON.stringify(
      entries.map(({ entry, files, mcp }) => ({
        entry,
        files: files?.map(({ path, sha256 }) => ({ path, sha256 })),
        mcp,
      })),
    ),
  )
  .digest('hex')
await mkdir(join(root, 'resources'), { recursive: true })
await writeFile(
  join(root, 'resources/tool-library-pack.json'),
  await format(JSON.stringify({ version: 1, revision, entries }), {
    ...formatting,
    parser: 'json',
  }),
)
const lines = [
  '# Reviewed MWIDE tool library',
  '',
  'Researched on 2026-10-23. This pack contains 70 Skills and 30 MCP configurations; 98 entries focus on software work. Sources and package artifacts are pinned where possible. Hosted services remain vendor updated. Installation state and connection checks are separate from selection in a project. No global Codex configuration is changed.',
  '',
  'Skill instructions and supporting files retain their upstream licenses. Supporting scripts are not executed automatically; provider-specific tool names may need adaptation. MCP account authorization and project access must be configured separately. Installing a package does not authorize tool invocation or grant cloud access.',
  '',
  '## Skills',
  '',
  '| Skill | Focus | Source revision | License |',
  '|---|---|---|---|',
  ...entries
    .filter(({ entry }) => entry.kind === 'skill')
    .map(
      ({ entry }) =>
        `| ${entry.name} | ${entry.category} | [${entry.source.revision.slice(0, 12)}](${entry.source.url}) | ${entry.source.license} |`,
    ),
  '',
  '## MCP servers',
  '',
  '| MCP | Version | Transport | Setup | Source |',
  '|---|---|---|---|---|',
  ...entries
    .filter(({ entry }) => entry.kind === 'mcp')
    .map(
      ({ entry, mcp }) =>
        `| ${entry.name} | ${entry.version} | ${mcp.transport} | ${mcp.requiresSetup ? 'Account or service configuration required' : mcp.requiresProject ? 'Saved project folder required' : 'No account required for inspection'} | [Official source](${entry.source.url}) |`,
    ),
  '',
  '## Reproduction',
  '',
  'Run `node scripts/build-tool-library.mjs` after restoring the hash-verified Skill staging directories referenced in `data/research/skills-candidates.json`. The committed bundle already contains those files, so normal installation does not require staging. Install it into a selected MWIDE profile with `node --experimental-strip-types scripts/install-tool-library.mjs --data-directory <MWIDE-profile>/tool-library --python <python-executable>`. The installer preserves personal projects, conversations and provider profiles. Npm lifecycle scripts are disabled; Python installations use binary wheels. Package locks and install diagnostics remain in the private installation directory.',
  '',
  'The original research manifests record excluded deprecated sources, prerequisites and compatibility limitations. `data/research/mcp-candidates.json` describes research, while the live installed library reports actual installation/check status.',
  '',
  'Serena requires the source-only legacy dependency `proxy_tools==0.1.0`. `scripts/prepare-python-wheels.py` verifies its fixed PyPI archive and constructs a deterministic pure-Python wheel with the standard library, without executing upstream setup/build code. The unchanged module, original metadata, upstream BSD license text and license-metadata discrepancy are retained in the wheel provenance. `--retry-errors` resumes incomplete installations while preserving verified runtimes. Serena dashboard and GUI windows are disabled for capability checks.',
  '',
  '## Attribution',
  '',
  '- [GitHub Awesome Copilot](https://github.com/github/awesome-copilot) — MIT.',
  '- [Trail of Bits Skills](https://github.com/trailofbits/skills) — CC-BY-SA-4.0; individual Skill files are preserved unchanged with license and attribution.',
  '- [Superpowers](https://github.com/obra/superpowers) — MIT.',
  '- [Anthropic Skills](https://github.com/anthropics/skills) — selected Apache-2.0 Skills only.',
  '- [Microsoft Skills](https://github.com/microsoft/skills) — MIT.',
  '',
  'These sources are selected for maintained provenance, useful scope and documented installation, not a claim that every item is universally the best.',
]
await writeFile(
  join(root, 'docs/tool-library.md'),
  await format(lines.join('\n') + '\n', { ...formatting, parser: 'markdown' }),
)
console.log(
  JSON.stringify({
    entries: entries.length,
    skills: 70,
    mcps: 30,
    coding: entries.filter(({ entry }) => entry.coding).length,
    revision,
  }),
)
