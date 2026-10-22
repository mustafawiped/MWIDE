export type CodeSymbolKind =
  'module' | 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable'

export interface CodeSymbol {
  id: string
  name: string
  qualifiedName: string
  file: string
  kind: CodeSymbolKind
  startLine: number
  endLine: number
  exported: boolean
  defaultExport?: boolean
  scopeId: string
  memberOf?: string
  static?: boolean
}

export interface CodeImport {
  local: string
  imported: string
  source: string
  namespace: boolean
  typeOnly: boolean
  line: number
}

export interface CodeCall {
  from: string
  callee: string
  scopeId: string
  line: number
  construct: boolean
}

export interface CodeBinding {
  scopeId: string
  name: string
  kind: 'symbol' | 'import' | 'parameter' | 'variable'
  target?: string
}

export interface ParsedCodeFile {
  path: string
  language: 'typescript' | 'javascript' | 'unsupported'
  symbols: CodeSymbol[]
  imports: CodeImport[]
  calls: CodeCall[]
  bindings: CodeBinding[]
  scopes: { id: string; parentId?: string; ownerSymbolId?: string }[]
  reExports: {
    source: string
    imported: string
    exported: string
    typeOnly?: boolean
    line?: number
  }[]
  diagnostics: { line: number; message: string }[]
}

export interface CodeEdge {
  from: string
  to: string
  type: 'CALLS' | 'IMPORTS'
  file: string
  line: number
  resolution: 'static'
}

export interface LinkedCodeGraph {
  edges: CodeEdge[]
  unresolvedCalls: number
  unresolvedImports: number
}

export interface CodeIndexStatus {
  root: string
  generation: number
  checkedAt: string
  files: number
  symbols: number
  edges: number
  parsedFiles: number
  reusedFiles: number
  bytesRead: number
  added: string[]
  modified: string[]
  deleted: string[]
  changes: { added: number; modified: number; deleted: number }
  changeListTruncated: boolean
  unresolvedCalls: number
  unresolvedImports: number
  partialFiles: number
  skippedFiles: number
  truncated: boolean
  durationMs: number
}

export type CodeGraphQuery =
  | { type: 'search'; query: string; limit?: number; offset?: number }
  | {
      type: 'trace'
      symbolId: string
      direction: 'inbound' | 'outbound' | 'both'
      depth?: number
      limit?: number
    }

export interface CodeGraphResult {
  status: CodeIndexStatus
  symbols: CodeSymbol[]
  edges: CodeEdge[]
  total: number
  truncated: boolean
}
