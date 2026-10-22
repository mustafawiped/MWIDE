import { posix } from 'node:path'
import type {
  CodeBinding,
  CodeEdge,
  CodeSymbol,
  LinkedCodeGraph,
  ParsedCodeFile,
} from '../shared/codegraph.ts'

const extensions = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const resolutionDepth = 64

/** Resolve only explicit lexical bindings and relative modules present in this snapshot. */
export function linkCodeGraph(files: ParsedCodeFile[]): LinkedCodeGraph {
  const result: LinkedCodeGraph = { edges: [], unresolvedCalls: 0, unresolvedImports: 0 }
  const byPath = new Map<string, ParsedCodeFile>()
  const duplicates = new Set<string>()
  const symbols = new Map<string, CodeSymbol>()
  const moduleFiles = new Map<string, ParsedCodeFile>()
  const bindings = new Map<string, CodeBinding[]>()
  const parents = new Map<string, string | undefined>()
  const owners = new Map<string, string | undefined>()
  const modules = new Map<string, CodeSymbol>()
  const members = new Map<string, CodeSymbol[]>()
  const classMembers = new Map<string, CodeSymbol[]>()
  const mutatedSymbols = new Set<string>()
  const imports = new Map<string, ParsedCodeFile['imports']>()
  const directExports = new Map<string, CodeSymbol[]>()
  const namedExports = new Map<string, ParsedCodeFile['reExports']>()
  const starExports = new Map<string, ParsedCodeFile['reExports']>()
  const moduleScopes = new Map<string, string>()
  for (const file of files) {
    if (byPath.has(file.path)) duplicates.add(file.path)
    byPath.set(file.path, file)
    for (const symbol of file.symbols) {
      symbols.set(symbol.id, symbol)
      if (symbol.kind === 'module') {
        modules.set(file.path, symbol)
        moduleFiles.set(symbol.id, file)
      }
      if (symbol.memberOf) {
        const key = `${symbol.memberOf}\0${symbol.name}`
        const group = members.get(key) ?? []
        group.push(symbol)
        members.set(key, group)
        const owned = classMembers.get(symbol.memberOf) ?? []
        owned.push(symbol)
        classMembers.set(symbol.memberOf, owned)
      }
    }
    for (const scope of file.scopes) {
      parents.set(scope.id, scope.parentId)
      owners.set(scope.id, scope.ownerSymbolId)
    }
    for (const binding of file.bindings) {
      const key = `${binding.scopeId}\0${binding.name}`
      const group = bindings.get(key) ?? []
      group.push(binding)
      bindings.set(key, group)
    }
    const module = modules.get(file.path)
    const moduleScope = file.scopes.find(
      (item) => item.ownerSymbolId === module?.id && !item.parentId,
    )?.id
    if (moduleScope) {
      moduleScopes.set(file.path, moduleScope)
      for (const item of file.symbols) {
        if (item.scopeId !== moduleScope || !item.exported) continue
        const key = `${file.path}\0${item.defaultExport ? 'default' : item.name}`
        const group = directExports.get(key) ?? []
        group.push(item)
        directExports.set(key, group)
      }
    }
    for (const item of file.imports) {
      const key = `${file.path}\0${item.local}`
      const group = imports.get(key) ?? []
      group.push(item)
      imports.set(key, group)
    }
    for (const item of file.reExports) {
      const target = item.exported === '*' ? starExports : namedExports
      const key = item.exported === '*' ? file.path : `${file.path}\0${item.exported}`
      const group = target.get(key) ?? []
      group.push(item)
      target.set(key, group)
    }
  }
  for (const duplicate of duplicates) byPath.delete(duplicate)
  function resolveModule(file: ParsedCodeFile, source: string): ParsedCodeFile | undefined {
    if (!source.startsWith('.') || /[?#\0]/.test(source)) return undefined
    const relative = posix.normalize(posix.join(posix.dirname(file.path), source))
    if (relative.startsWith('../') || relative === '..' || posix.isAbsolute(relative))
      return undefined
    let candidates: string[]
    if (/\.[cm]?jsx?$/i.test(relative)) {
      const substitution = relative.replace(/\.[cm]?jsx?$/i, '')
      const suffixes = /\.mjs$/i.test(relative)
        ? ['.mts', '.d.mts']
        : /\.cjs$/i.test(relative)
          ? ['.cts', '.d.cts']
          : ['.ts', '.tsx', '.d.ts']
      candidates = [...suffixes.map((suffix) => `${substitution}${suffix}`), relative]
    } else if (posix.extname(relative)) candidates = [relative]
    else
      candidates = [
        ...extensions.map((suffix) => `${relative}${suffix}`),
        ...extensions.map((suffix) => `${relative}/index${suffix}`),
      ]
    return candidates
      .map((candidate) => byPath.get(candidate))
      .find((candidate) => candidate && candidate.language !== 'unsupported')
  }
  function findBindings(scopeId: string, name: string): CodeBinding[] | undefined {
    let current: string | undefined = scopeId
    const visited = new Set<string>()
    while (current && !visited.has(current)) {
      visited.add(current)
      const found = bindings
        .get(`${current}\0${name}`)
        ?.filter((binding) => !binding.target || !symbols.get(binding.target)?.memberOf)
      // Class member declarations are not unqualified lexical bindings in JavaScript.
      if (found?.length) return found
      current = parents.get(current)
    }
    return undefined
  }
  const exportCache = new Map<string, string | null>()
  let resolutionSteps = 0
  let cycleHits = 0
  const stepLimit = Math.min(1_000_000, Math.max(100_000, symbols.size * 20))
  function localTarget(
    file: ParsedCodeFile,
    scopeId: string,
    name: string,
    allowTypes: boolean,
    seen: Set<string>,
  ): string | undefined {
    const found = findBindings(scopeId, name)
    if (!found?.length) return undefined
    const targets = new Set<string>()
    for (const binding of found) {
      if (binding.kind === 'import') {
        const matching = imports.get(`${file.path}\0${name}`) ?? []
        if (matching.length !== 1 || (!allowTypes && matching[0].typeOnly)) return undefined
        const imported = matching[0]
        const targetFile = resolveModule(file, imported.source)
        if (!targetFile) return undefined
        const target = imported.namespace
          ? modules.get(targetFile.path)?.id
          : exportedTarget(targetFile, imported.imported, allowTypes, seen)
        if (!target) return undefined
        targets.add(target)
      } else if (binding.target && binding.kind === 'symbol') targets.add(binding.target)
      else if (allowTypes && binding.target && binding.kind === 'variable')
        targets.add(binding.target)
      else return undefined
    }
    return targets.size === 1 ? [...targets][0] : undefined
  }
  function exportedTarget(
    file: ParsedCodeFile,
    name: string,
    allowTypes: boolean,
    seen: Set<string>,
  ): string | undefined | null {
    const key = `${file.path}\0${name}\0${allowTypes}`
    if (++resolutionSteps > stepLimit || seen.size >= resolutionDepth) return null
    if (seen.has(key)) {
      cycleHits++
      return undefined
    }
    const cached = exportCache.get(key)
    if (cached !== undefined) return cached
    const initialCycleHits = cycleHits
    const next = new Set(seen).add(key)
    const moduleScope = moduleScopes.get(file.path)
    if (!moduleScope) return undefined
    const direct = directExports.get(`${file.path}\0${name}`) ?? []
    const aliases = (namedExports.get(`${file.path}\0${name}`) ?? []).filter(
      (item) => allowTypes || !item.typeOnly,
    )
    const targets = new Set(direct.map((item) => item.id))
    let unresolvedExplicit = false
    if (!allowTypes) {
      for (const item of direct) {
        const found = findBindings(moduleScope, item.name)
        if (found?.some((binding) => binding.kind === 'variable' && !binding.target))
          unresolvedExplicit = true
      }
    }
    for (const alias of aliases) {
      let target: string | undefined | null
      if (!alias.source) target = localTarget(file, moduleScope, alias.imported, allowTypes, next)
      else {
        const targetFile = resolveModule(file, alias.source)
        if (targetFile) {
          target =
            alias.imported === '*'
              ? modules.get(targetFile.path)?.id
              : exportedTarget(targetFile, alias.imported, allowTypes, next)
        }
      }
      if (target) targets.add(target)
      else unresolvedExplicit = true
    }
    if (direct.length || aliases.length) {
      const target = !unresolvedExplicit && targets.size === 1 ? [...targets][0] : null
      // Only acyclic traversals and complete root lookups are safe to memoize.
      if (seen.size === 0 || cycleHits === initialCycleHits) exportCache.set(key, target)
      return target
    }
    if (name === 'default') return undefined
    let ambiguous = false
    for (const star of (starExports.get(file.path) ?? []).filter(
      (item) => allowTypes || !item.typeOnly,
    )) {
      const targetFile = resolveModule(file, star.source)
      const target = targetFile ? exportedTarget(targetFile, name, allowTypes, next) : null
      if (target) targets.add(target)
      else if (target === null) ambiguous = true
    }
    const target =
      ambiguous || targets.size > 1 ? null : targets.size === 1 ? [...targets][0] : undefined
    if (target !== undefined && (seen.size === 0 || cycleHits === initialCycleHits))
      exportCache.set(key, target)
    return target
  }
  function classMember(classId: string, name: string, staticMember: boolean): string | undefined {
    const found = members
      .get(`${classId}\0${name}`)
      ?.filter((member) => !!member.static === staticMember)
    if (found?.length !== 1 || found[0].kind !== 'method' || mutatedSymbols.has(found[0].id))
      return undefined
    return found[0].id
  }
  function thisTarget(
    file: ParsedCodeFile,
    scopeId: string,
  ): { id: string; static: boolean } | undefined {
    const found = findBindings(scopeId, 'this')
    if (found?.length !== 1 || found[0].kind !== 'symbol' || !found[0].target) return undefined
    const classId = found[0].target
    if (symbols.get(classId)?.kind !== 'class') return undefined
    let current: string | undefined = scopeId
    while (current) {
      const owner = symbols.get(owners.get(current) ?? '')
      if (owner?.memberOf === classId) return { id: classId, static: !!owner.static }
      // A class static block has no method owner. Its own `this` binding is static.
      if (owner?.id === classId && bindings.get(`${current}\0this`)?.length)
        return { id: classId, static: true }
      current = parents.get(current)
    }
    void file
    return undefined
  }
  function callTarget(file: ParsedCodeFile, scopeId: string, callee: string): string | undefined {
    const parts = callee.split('.')
    if (parts.some((part) => !part || part.startsWith('<'))) return undefined
    let target: string | undefined
    let offset = 1
    if (parts[0] === 'this') {
      const receiver = thisTarget(file, scopeId)
      if (!receiver || parts.length < 2) return undefined
      target = classMember(receiver.id, parts[1], receiver.static)
      offset = 2
    } else target = localTarget(file, scopeId, parts[0], false, new Set())
    for (let index = offset; target && index < parts.length; index++) {
      const symbol = symbols.get(target)
      if (symbol?.kind === 'module') {
        const importedFile = moduleFiles.get(target)
        target = importedFile
          ? (exportedTarget(importedFile, parts[index], false, new Set()) ?? undefined)
          : undefined
      } else if (symbol?.kind === 'class') target = classMember(symbol.id, parts[index], true)
      else return undefined
    }
    return target
  }
  const uniqueEdges = new Set<string>()
  for (const file of files) {
    for (const binding of file.bindings) {
      if (binding.kind !== 'variable' || !binding.name.includes('.')) continue
      const parts = binding.name.split('.')
      const member = parts.pop()!
      const prototype = parts.at(-1) === 'prototype'
      if (prototype) parts.pop()
      const receiver = parts.join('.')
      const thisReceiver = receiver === 'this' ? thisTarget(file, binding.scopeId) : undefined
      const target = thisReceiver?.id ?? callTarget(file, binding.scopeId, receiver)
      const symbol = target ? symbols.get(target) : undefined
      if (!target || !symbol) continue
      if (symbol.kind === 'class') {
        const isStatic = thisReceiver ? thisReceiver.static : !prototype
        const candidates =
          member === '*' ? classMembers.get(target) : members.get(`${target}\0${member}`)
        for (const item of candidates ?? []) {
          if (!!item.static === isStatic) mutatedSymbols.add(item.id)
        }
      } else if (symbol.kind === 'module') {
        const importedFile = moduleFiles.get(target)
        const exported = importedFile && exportedTarget(importedFile, member, false, new Set())
        if (exported) mutatedSymbols.add(exported)
      }
    }
  }
  function edge(
    from: string,
    to: string,
    type: CodeEdge['type'],
    file: string,
    line: number,
  ): void {
    const key = `${from}\0${to}\0${type}\0${file}\0${line}`
    if (uniqueEdges.has(key)) return
    uniqueEdges.add(key)
    result.edges.push({ from, to, type, file, line, resolution: 'static' })
  }
  for (const file of files) {
    const module = modules.get(file.path)
    if (!module || duplicates.has(file.path)) continue
    for (const imported of file.imports) {
      const targetFile = resolveModule(file, imported.source)
      const target =
        targetFile &&
        (imported.namespace || !imported.local
          ? modules.get(targetFile.path)?.id
          : exportedTarget(targetFile, imported.imported, true, new Set()))
      if (target) edge(module.id, target, 'IMPORTS', file.path, imported.line)
      else result.unresolvedImports++
    }
    for (const reExport of file.reExports) {
      if (!reExport.source) continue
      const targetFile = resolveModule(file, reExport.source)
      const target =
        targetFile &&
        (reExport.imported === '*'
          ? modules.get(targetFile.path)?.id
          : exportedTarget(targetFile, reExport.imported, true, new Set()))
      if (target) edge(module.id, target, 'IMPORTS', file.path, reExport.line ?? 1)
      else result.unresolvedImports++
    }
    for (const call of file.calls) {
      const target = callTarget(file, call.scopeId, call.callee)
      const symbol = target ? symbols.get(target) : undefined
      const callable = call.construct
        ? symbol?.kind === 'class' || symbol?.kind === 'function'
        : symbol?.kind === 'function' || symbol?.kind === 'method'
      if (target && callable && !mutatedSymbols.has(target))
        edge(call.from, target, 'CALLS', file.path, call.line)
      else result.unresolvedCalls++
    }
  }
  return result
}
