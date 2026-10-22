import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { CodeGraphResult, CodeIndexStatus, CodeSymbol } from '../../shared/codegraph'
import type { WorkspaceController } from './useWorkspace'
import './project-code-index.css'

const pageSize = 2
type Direction = 'inbound' | 'outbound'

export function ProjectCodeIndex({
  projectId,
  folderPath,
  folderSaved,
  workspace,
}: {
  projectId?: string
  folderPath?: string
  folderSaved: boolean
  workspace: WorkspaceController
}): JSX.Element {
  const [status, setStatus] = useState<CodeIndexStatus>()
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<CodeGraphResult>()
  const [selected, setSelected] = useState<CodeSymbol>()
  const [trace, setTrace] = useState<CodeGraphResult>()
  const [direction, setDirection] = useState<Direction>('outbound')
  const [offset, setOffset] = useState(0)
  const [tracePage, setTracePage] = useState(0)
  const [checked, setChecked] = useState(false)
  const request = useRef<symbol>(undefined)
  const initialInspection = useRef<{
    key: string
    result: Promise<CodeIndexStatus | undefined>
  }>(undefined)
  const execute = workspace.execute
  const ready = Boolean(projectId && folderPath && folderSaved)
  const disabled = workspace.pending || Boolean(workspace.generatingId) || !workspace.available

  useEffect(() => {
    if (!ready || !projectId) return
    const current = Symbol()
    request.current = current
    const key = `${projectId}:${folderPath}`
    if (initialInspection.current?.key !== key) {
      initialInspection.current = {
        key,
        result: execute((bridge) => bridge.inspectProjectCode(projectId)),
      }
    }
    void initialInspection.current.result.then((next) => {
      if (current !== request.current) return
      if (next) setStatus(next)
      setChecked(true)
    })
    return () => {
      request.current = undefined
    }
  }, [execute, folderPath, projectId, ready])

  const refresh = async () => {
    if (!projectId || disabled) return
    const current = Symbol()
    request.current = current
    const next = await execute((bridge) => bridge.inspectProjectCode(projectId))
    if (current !== request.current) return
    if (next) {
      setStatus(next)
      setResult(undefined)
      setSelected(undefined)
      setTrace(undefined)
      setOffset(0)
      setTracePage(0)
    }
    setChecked(true)
  }
  const search = async (nextOffset = 0) => {
    if (!projectId || disabled || !status) return
    const current = Symbol()
    request.current = current
    const next = await execute((bridge) =>
      bridge.queryProjectCode({
        projectId,
        query: { type: 'search', query: query.trim(), limit: pageSize, offset: nextOffset },
      }),
    )
    if (current !== request.current || !next) return
    setStatus(next.status)
    setResult(next)
    setOffset(nextOffset)
    setSelected(undefined)
    setTrace(undefined)
  }
  const showTrace = async (symbol: CodeSymbol, nextDirection = direction) => {
    if (!projectId || disabled) return
    setSelected(symbol)
    setDirection(nextDirection)
    setTrace(undefined)
    setTracePage(0)
    const current = Symbol()
    request.current = current
    const next = await execute((bridge) =>
      bridge.queryProjectCode({
        projectId,
        query: {
          type: 'trace',
          symbolId: symbol.id,
          direction: nextDirection,
          depth: 2,
          limit: 8,
        },
      }),
    )
    if (current !== request.current || !next) return
    setTrace(next)
    setStatus(next.status)
  }
  const searchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!event.nativeEvent.isComposing) void search()
  }
  const coverage = status
    ? `${status.partialFiles} partial · ${status.skippedFiles} skipped · ${status.unresolvedCalls} unresolved calls · ${status.unresolvedImports} unresolved imports${status.truncated ? ' · index limited' : ''}`
    : ''
  const changes = status
    ? `Last scan: +${status.changes.added} added · ${status.changes.modified} modified · −${status.changes.deleted} deleted · ${status.reusedFiles} reused`
    : ''
  const tracePages = Math.max(1, Math.ceil((trace?.edges.length ?? 0) / pageSize))
  const currentTracePage = Math.min(tracePage, tracePages - 1)
  const visibleEdges = trace?.edges.slice(
    currentTracePage * pageSize,
    (currentTracePage + 1) * pageSize,
  )
  const symbolById = new Map(trace?.symbols.map((symbol) => [symbol.id, symbol]))

  return (
    <div
      className="panel editor-section code-index-panel"
      id="project-panel-index"
      role="tabpanel"
      aria-labelledby="project-tab-index"
    >
      <div className="code-index-heading">
        <h2>Code index</h2>
        <span className="badge">TypeScript / JavaScript</span>
        {ready && (
          <button
            className="button secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={disabled}
          >
            Refresh index
          </button>
        )}
      </div>
      {!ready ? (
        <p className="inline-empty">
          {!folderPath
            ? 'Choose a project folder in Folder, then save the project to build its code index.'
            : !projectId || !folderSaved
              ? 'Save this project and folder selection, then reopen Code index.'
              : 'The project folder is unavailable.'}
        </p>
      ) : (
        <>
          <div className="code-index-status" aria-live="polite">
            {status ? (
              <>
                <span className="code-index-counts">
                  <strong>{status.files}</strong> files · <strong>{status.symbols}</strong> symbols
                  · <strong>{status.edges}</strong> relationships
                </span>
                <span className="code-index-changes" title={changes}>
                  {changes}
                </span>
              </>
            ) : (
              <span>
                {checked ? 'Index unavailable. Try Refresh index.' : 'Checking project code…'}
              </span>
            )}
          </div>
          {selected ? (
            <>
              <div className="code-index-tools code-index-trace-tools">
                <button
                  className="button ghost"
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    request.current = undefined
                    setSelected(undefined)
                    setTrace(undefined)
                  }}
                >
                  Back to symbols
                </button>
                <span
                  className="code-index-selected"
                  title={`${selected.name} · ${selected.file}:${selected.startLine}`}
                >
                  {selected.name}
                </span>
                <label>
                  <span className="sr-only">Call direction</span>
                  <select
                    aria-label="Call direction"
                    className="select"
                    value={direction}
                    disabled={disabled}
                    onChange={(event) => void showTrace(selected, event.target.value as Direction)}
                  >
                    <option value="outbound">Calls made</option>
                    <option value="inbound">Callers</option>
                  </select>
                </label>
              </div>
              <div
                className="code-index-results"
                aria-label="Static call relationships"
                aria-live="polite"
              >
                {trace ? (
                  trace.edges.length ? (
                    visibleEdges?.map((edge) => {
                      const from = symbolById.get(edge.from)
                      const to = symbolById.get(edge.to)
                      const label = `${from?.name ?? edge.from} → ${to?.name ?? edge.to}`
                      const path = `${edge.file}:${edge.line}`
                      return (
                        <div
                          className="code-index-edge"
                          key={`${edge.from}:${edge.to}:${edge.line}`}
                        >
                          <strong title={label}>{label}</strong>
                          <span title={path}>{path}</span>
                        </div>
                      )
                    })
                  ) : (
                    <p className="code-index-empty">
                      {trace.symbols.some((symbol) => symbol.id === selected.id)
                        ? 'No resolved calls in this direction.'
                        : 'This symbol changed or is no longer indexed. Search again.'}
                    </p>
                  )
                ) : (
                  <p className="code-index-empty">
                    {disabled
                      ? 'Loading call relationships…'
                      : 'Call relationships unavailable. Select a direction to retry.'}
                  </p>
                )}
              </div>
              <nav
                className="compact-pagination code-index-pagination"
                aria-label="Call relationship pages"
              >
                <span className="code-index-page-note">
                  {trace
                    ? `${trace.edges.length} calls loaded${trace.truncated ? ' · result limited' : ''}`
                    : 'Static calls · depth 2'}
                </span>
                <button
                  className="button ghost"
                  type="button"
                  disabled={disabled || currentTracePage === 0}
                  onClick={() => setTracePage(currentTracePage - 1)}
                >
                  Previous
                </button>
                <span>
                  {currentTracePage + 1} / {tracePages}
                </span>
                <button
                  className="button ghost"
                  type="button"
                  disabled={disabled || currentTracePage >= tracePages - 1}
                  onClick={() => setTracePage(currentTracePage + 1)}
                >
                  Next
                </button>
              </nav>
            </>
          ) : (
            <>
              <div className="code-index-tools">
                <label className="code-index-search-label">
                  <span className="sr-only">Search code symbols</span>
                  <input
                    ref={searchInput}
                    className="input"
                    placeholder="Find a symbol or file…"
                    value={query}
                    maxLength={120}
                    disabled={disabled || !status}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setResult(undefined)
                      setOffset(0)
                    }}
                    onKeyDown={searchKey}
                  />
                </label>
                {query && (
                  <button
                    className="button ghost"
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      request.current = undefined
                      setQuery('')
                      setResult(undefined)
                      setOffset(0)
                      setSelected(undefined)
                      setTrace(undefined)
                      searchInput.current?.focus()
                    }}
                  >
                    Clear search
                  </button>
                )}
                <button
                  className="button secondary"
                  type="button"
                  disabled={disabled || !status}
                  onClick={() => void search()}
                >
                  Search symbols
                </button>
              </div>
              <div className="code-index-results" aria-label="Code symbols" aria-live="polite">
                {result ? (
                  result.symbols.length ? (
                    result.symbols.map((symbol) => (
                      <button
                        className="code-index-symbol"
                        type="button"
                        key={symbol.id}
                        disabled={disabled}
                        onClick={() => void showTrace(symbol)}
                      >
                        <span>
                          <strong title={symbol.name}>{symbol.name}</strong>
                          <span className="code-index-kind">{symbol.kind}</span>
                        </span>
                        <span title={`${symbol.file}:${symbol.startLine}`}>
                          {symbol.file}:{symbol.startLine}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="code-index-empty">No matching indexed symbols.</p>
                  )
                ) : (
                  <p className="code-index-empty">
                    Search symbols, then select one to inspect callers and calls.
                  </p>
                )}
              </div>
              <nav
                className="compact-pagination code-index-pagination"
                aria-label="Code symbol pages"
              >
                <span className="code-index-page-note">
                  {result
                    ? `${offset + (result.symbols.length ? 1 : 0)}–${offset + result.symbols.length} of ${result.total}`
                    : 'Read-only project evidence'}
                </span>
                <button
                  className="button ghost"
                  type="button"
                  disabled={disabled || offset === 0}
                  onClick={() => void search(Math.max(0, offset - pageSize))}
                >
                  Previous
                </button>
                <button
                  className="button ghost"
                  type="button"
                  disabled={disabled || !result || offset + result.symbols.length >= result.total}
                  onClick={() => void search(offset + pageSize)}
                >
                  Next
                </button>
              </nav>
            </>
          )}
          <p className="code-index-coverage" title={coverage}>
            {coverage || 'Only supported static relationships can be resolved.'}
          </p>
        </>
      )}
    </div>
  )
}
