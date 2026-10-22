import { constants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  canonicalProjectFolder,
  hiddenSecret,
  ignored,
  ignoreRules,
  inside,
  samePath,
} from './project-folder.ts'
import type { IgnoreRule } from './project-folder.ts'

export const MAX_CODE_FILES = 10_000
export const MAX_CODE_FILE_BYTES = 256 * 1_024
export const MAX_CODE_READ_BYTES = 32 * 1_024 * 1_024
const MAX_ENTRIES = 50_000
const MAX_DIRECTORIES = 4_000
const MAX_DEPTH = 32
const MAX_IGNORE_BYTES = 64 * 1_024
const MAX_IGNORE_RULES = 2_000

export interface CodeFileEntry {
  path: string
  absolutePath: string
  fingerprint: string
  size: number
}

export interface CachedIgnorePolicy {
  fingerprint: string
  text: string
}

export interface CodeFileScan {
  root: string
  identity: string
  files: CodeFileEntry[]
  policies: Map<string, CachedIgnorePolicy>
  truncated: boolean
}

function identity(metadata: BigIntStats): string {
  return `${metadata.dev}:${metadata.ino}`
}

function fingerprint(metadata: BigIntStats): string {
  return `${identity(metadata)}:${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}:${metadata.nlink}`
}

export async function assertCodeRoot(root: string, expectedIdentity?: string): Promise<string> {
  const metadata = await lstat(root, { bigint: true })
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !samePath(await realpath(root), resolve(root)) ||
    (expectedIdentity !== undefined && expectedIdentity !== identity(metadata))
  ) {
    throw new Error('The project folder location has changed. Choose the project folder again.')
  }
  return identity(metadata)
}

/** Read a complete bounded file only while its opened identity remains inside the selected root. */
export async function readCodeSource(
  root: string,
  entry: CodeFileEntry,
  maximumBytes = MAX_CODE_FILE_BYTES,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted()
  const before = await lstat(entry.absolutePath, { bigint: true })
  const canonical = await realpath(entry.absolutePath)
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink > 1n ||
    before.size > BigInt(maximumBytes) ||
    fingerprint(before) !== entry.fingerprint ||
    !inside(root, canonical) ||
    !samePath(canonical, resolve(entry.absolutePath))
  ) {
    throw new Error(
      `Project file changed during indexing: ${JSON.stringify(entry.path)}. Retry indexing.`,
    )
  }
  const handle = await open(entry.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat({ bigint: true })
    if (fingerprint(opened) !== entry.fingerprint || !opened.isFile() || opened.nlink > 1n) {
      throw new Error(
        `Project file changed during indexing: ${JSON.stringify(entry.path)}. Retry indexing.`,
      )
    }
    const buffer = Buffer.alloc(Number(opened.size))
    let length = 0
    while (length < buffer.length) {
      signal?.throwIfAborted()
      const result = await handle.read(buffer, length, buffer.length - length, length)
      if (result.bytesRead === 0) break
      length += result.bytesRead
    }
    signal?.throwIfAborted()
    const after = await handle.stat({ bigint: true })
    if (
      length !== buffer.length ||
      fingerprint(after) !== entry.fingerprint ||
      !samePath(await realpath(entry.absolutePath), canonical) ||
      fingerprint(await lstat(entry.absolutePath, { bigint: true })) !== entry.fingerprint
    ) {
      throw new Error(
        `Project file changed during indexing: ${JSON.stringify(entry.path)}. Retry indexing.`,
      )
    }
    return buffer
  } finally {
    await handle.close()
  }
}

/** Fresh metadata traversal; cached policy text is reused only for an identical stat identity. */
export async function scanCodeFiles(
  folderPath: string,
  previousPolicies = new Map<string, CachedIgnorePolicy>(),
  signal?: AbortSignal,
): Promise<CodeFileScan> {
  signal?.throwIfAborted()
  const root = await canonicalProjectFolder(folderPath)
  if (!samePath(root, resolve(folderPath))) {
    throw new Error('The project folder location has changed. Choose the project folder again.')
  }
  const rootIdentity = await assertCodeRoot(root)
  const files: CodeFileEntry[] = []
  const policies = new Map<string, CachedIgnorePolicy>()
  const queue: { path: string; local: string; depth: number; rules: IgnoreRule[] }[] = [
    { path: root, local: '', depth: 0, rules: [] },
  ]
  let visited = 0
  let directories = 0
  let ruleCount = 0
  let truncated = false

  while (queue.length && visited < MAX_ENTRIES) {
    signal?.throwIfAborted()
    const current = queue.shift()!
    const directoryMetadata = await lstat(current.path, { bigint: true })
    if (
      directoryMetadata.isSymbolicLink() ||
      !directoryMetadata.isDirectory() ||
      !samePath(await realpath(current.path), resolve(current.path))
    ) {
      throw new Error('The project folder location has changed. Choose the project folder again.')
    }
    let rules = current.rules
    const ignorePath = join(current.path, '.gitignore')
    try {
      const metadata = await lstat(ignorePath, { bigint: true })
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1n) {
        throw new Error('A project .gitignore is not a regular file. Check folder exclusions.')
      }
      if (metadata.size > BigInt(MAX_IGNORE_BYTES)) {
        throw new Error('A .gitignore file exceeds the indexing limit.')
      }
      const key = current.local ? `${current.local}/.gitignore` : '.gitignore'
      const previous = previousPolicies.get(key)
      const metadataKey = fingerprint(metadata)
      const text =
        previous?.fingerprint === metadataKey
          ? previous.text
          : (
              await readCodeSource(
                root,
                {
                  path: key,
                  absolutePath: ignorePath,
                  fingerprint: metadataKey,
                  size: Number(metadata.size),
                },
                MAX_IGNORE_BYTES,
                signal,
              )
            ).toString('utf8')
      if (text.includes('\0')) throw new Error('A .gitignore file contains invalid binary data.')
      const added = ignoreRules(text, current.local)
      ruleCount += added.length
      if (ruleCount > MAX_IGNORE_RULES) throw new Error('The folder has too many .gitignore rules.')
      policies.set(key, { fingerprint: metadataKey, text })
      rules = [...rules, ...added]
    } catch (error) {
      signal?.throwIfAborted()
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    const names: string[] = []
    const directory = await opendir(current.path)
    for await (const entry of directory) {
      signal?.throwIfAborted()
      if (visited >= MAX_ENTRIES) {
        truncated = true
        break
      }
      visited += 1
      names.push(entry.name)
    }
    names.sort()
    // Eight independent metadata reads overlap filesystem latency without unbounded handles or buffers.
    for (let position = 0; position < names.length; position += 8) {
      const inspected = await Promise.all(
        names.slice(position, position + 8).map(async (name) => {
          signal?.throwIfAborted()
          if (hiddenSecret(name, false)) return null
          const absolutePath = join(current.path, name)
          const local = current.local ? `${current.local}/${name}` : name
          let metadata: BigIntStats
          try {
            metadata = await lstat(absolutePath, { bigint: true })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            throw new Error(
              `Project file changed during indexing: ${JSON.stringify(local)}. Retry indexing.`,
              { cause: error },
            )
          }
          if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()))
            return null
          if (
            hiddenSecret(name, metadata.isDirectory()) ||
            ignored(local, metadata.isDirectory(), rules)
          )
            return null
          const canonical = await realpath(absolutePath)
          if (!inside(root, canonical) || !samePath(canonical, resolve(absolutePath))) return null
          return { absolutePath, local, metadata }
        }),
      )
      for (const entry of inspected) {
        signal?.throwIfAborted()
        if (!entry) continue
        const { absolutePath, local, metadata } = entry
        if (metadata.isDirectory()) {
          directories += 1
          if (directories > MAX_DIRECTORIES || current.depth + 1 >= MAX_DEPTH) {
            truncated = true
            continue
          }
          queue.push({ path: absolutePath, local, depth: current.depth + 1, rules })
        } else if (metadata.nlink <= 1n) {
          if (files.length >= MAX_CODE_FILES) {
            truncated = true
            continue
          }
          files.push({
            path: local,
            absolutePath,
            fingerprint: fingerprint(metadata),
            size: Number(metadata.size),
          })
        }
      }
    }
  }
  if (queue.length) truncated = true
  await assertCodeRoot(root, rootIdentity)
  signal?.throwIfAborted()
  return { root, identity: rootIdentity, files, policies, truncated }
}
