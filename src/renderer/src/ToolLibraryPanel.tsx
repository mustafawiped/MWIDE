import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import type {
  ToolLibraryEntry,
  ToolLibraryInspection,
  ToolLibraryState,
} from '../../shared/tool-library'
import type { WorkspaceController } from './useWorkspace'
import { CompactTabs } from './CompactTabs'
import { EmptyState, Icon } from './ui'
import './tool-library.css'

type DetailSection = 'overview' | 'source' | 'access' | 'tools'
const detailPageSize = 2
const libraryRowGap = 8
const minimumLibraryRowHeight = 100
const maximumLibraryRowHeight = 112
const stateLabels: Record<ToolLibraryEntry['state'], string> = {
  installed: 'Installed',
  'needs-setup': 'Needs setup',
  available: 'Available',
  error: 'Unavailable',
}

export function ToolLibraryPanel({ workspace }: { workspace: WorkspaceController }): JSX.Element {
  const { execute, mutate } = workspace
  const [library, setLibrary] = useState<ToolLibraryState>()
  const [checked, setChecked] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(0)
  const [listLayout, setListLayout] = useState({ pageSize: 2, rowHeight: maximumLibraryRowHeight })
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<DetailSection>('overview')
  const [detailPage, setDetailPage] = useState(0)
  const [inspection, setInspection] = useState<ToolLibraryInspection>()
  const [projectId, setProjectId] = useState('')
  const [imported, setImported] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const visiblePageSize = useRef(2)
  const backButton = useRef<HTMLButtonElement>(null)
  const initialLoad = useRef<Promise<ToolLibraryState | undefined>>(undefined)
  const request = useRef<symbol | undefined>(undefined)
  const mounted = useRef(false)
  const disabled = workspace.pending || Boolean(workspace.generatingId)

  useEffect(() => {
    mounted.current = true
    let disposed = false
    initialLoad.current ??= execute((bridge) => bridge.getToolLibrary())
    void initialLoad.current.then((next) => {
      if (disposed) return
      if (next) setLibrary(next)
      setChecked(true)
    })
    return () => {
      disposed = true
      mounted.current = false
      request.current = undefined
    }
  }, [execute])

  const refresh = async () => {
    if (disabled) return
    const next = await execute((bridge) => bridge.getToolLibrary())
    if (!mounted.current) return
    if (next) setLibrary(next)
    setChecked(true)
  }
  const importInstalled = async () => {
    if (disabled) return
    const next = await mutate((bridge) => bridge.importToolLibrary())
    if (next && mounted.current) setImported(true)
  }
  const inspect = async (entry: ToolLibraryEntry) => {
    if (disabled) return
    const current = Symbol()
    request.current = current
    setInspection(undefined)
    const next = await execute((bridge) =>
      bridge.inspectLibraryMcp({ id: entry.id, ...(projectId ? { projectId } : {}) }),
    )
    if (!mounted.current || current !== request.current || !next) return
    setInspection(next)
  }
  const entries = library?.entries ?? []
  const categories = [...new Set(entries.map((entry) => entry.category))].sort()
  const normalized = query.trim().toLocaleLowerCase('en')
  const filtered = entries.filter(
    (entry) =>
      (kind === 'all' || entry.kind === kind) &&
      (category === 'all' || entry.category === category) &&
      (status === 'all' || entry.state === status) &&
      (!normalized ||
        [entry.name, entry.description, entry.category, ...entry.tags]
          .join(' ')
          .toLocaleLowerCase('en')
          .includes(normalized)),
  )
  const pageSize = listLayout.pageSize
  useEffect(() => {
    const element = list.current
    if (!element || selectedId) return
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.contentRect.height
      if (height <= 0) return
      const rows = Math.max(
        1,
        Math.min(
          6,
          Math.floor((height + libraryRowGap) / (minimumLibraryRowHeight + libraryRowGap)),
        ),
      )
      const rowHeight = Math.max(
        0,
        Math.min(maximumLibraryRowHeight, Math.floor((height - libraryRowGap * (rows - 1)) / rows)),
      )
      const previousSize = visiblePageSize.current
      if (previousSize !== rows) {
        visiblePageSize.current = rows
        setPage((previous) => {
          const previousPage = Math.min(
            previous,
            Math.max(0, Math.ceil(filtered.length / previousSize) - 1),
          )
          return Math.floor((previousPage * previousSize) / rows)
        })
      }
      setListLayout((previous) =>
        previous.pageSize === rows && previous.rowHeight === rowHeight
          ? previous
          : { pageSize: rows, rowHeight },
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [filtered.length, selectedId])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const selected = entries.find((entry) => entry.id === selectedId)
  const installedCount = entries.filter((entry) => entry.state === 'installed').length
  const detailItems = selected
    ? detail === 'access'
      ? [
          ...selected.requirements.map((text) => ({ label: 'Setup', text })),
          ...selected.access.map((text) => ({ label: 'Access', text })),
        ]
      : detail === 'tools'
        ? (inspection?.tools ?? []).map((tool) => ({ label: tool.name, text: tool.description }))
        : []
    : []
  const detailPages = Math.max(1, Math.ceil(detailItems.length / detailPageSize))
  const currentDetailPage = Math.min(detailPage, detailPages - 1)
  const select = (entry?: ToolLibraryEntry) => {
    const previousId = selectedId
    request.current = undefined
    setSelectedId(entry?.id)
    setDetail('overview')
    setDetailPage(0)
    setInspection(undefined)
    requestAnimationFrame(() => {
      if (!mounted.current) return
      if (entry) backButton.current?.focus()
      else
        [...document.querySelectorAll<HTMLButtonElement>('[data-library-entry]')]
          .find((button) => button.dataset.libraryEntry === previousId)
          ?.focus()
    })
  }
  const chooseDetail = (value: DetailSection) => {
    setDetail(value)
    setDetailPage(0)
  }

  return (
    <section
      className="tool-library-panel"
      id="catalog-view-panel-library"
      role="tabpanel"
      aria-labelledby="catalog-view-tab-library"
    >
      <div className="library-summary">
        <span className="hint" role="status">
          {library
            ? `${entries.length} tools · ${installedCount} installed · ${entries.filter((entry) => entry.coding).length} for development`
            : checked
              ? 'Library unavailable. Refresh to try again.'
              : 'Loading tool library…'}
        </span>
        <button className="button ghost" disabled={disabled} onClick={() => void refresh()}>
          Refresh library
        </button>
        <button
          ref={backButton}
          className="button secondary library-import"
          disabled={disabled || installedCount === 0}
          onClick={() => void importInstalled()}
        >
          Add installed tools to catalog
        </button>
      </div>
      <p className="library-notice" role={imported ? 'status' : undefined}>
        {imported
          ? 'Installed tools added to your catalog. Choose them in project context to use their instructions.'
          : 'Skills supply instructions. MCP connection checks list available tools; AI tool execution is not enabled.'}
      </p>
      {selected ? (
        <div className="panel library-detail">
          <div className="library-detail-heading">
            <button className="button ghost" disabled={disabled} onClick={() => select()}>
              Back to library
            </button>
            <h2 title={selected.name}>{selected.name}</h2>
            <span className="badge">{stateLabels[selected.state]}</span>
          </div>
          <CompactTabs
            id="library-detail"
            label="Tool details"
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'source', label: 'Source' },
              { value: 'access', label: 'Setup & access' },
              ...(selected.kind === 'mcp'
                ? [{ value: 'tools' as const, label: 'Connection' }]
                : []),
            ]}
            selected={detail}
            onSelect={chooseDetail}
            disabled={disabled}
          />
          <div
            className="library-detail-content"
            id={`library-detail-panel-${detail}`}
            role="tabpanel"
            aria-labelledby={`library-detail-tab-${detail}`}
          >
            {detail === 'overview' && (
              <>
                <div className="library-detail-meta">
                  <span className="badge">{selected.kind === 'mcp' ? 'MCP' : 'Skill'}</span>
                  <span>{selected.category}</span>
                  <span>{selected.version}</span>
                </div>
                <p className="library-description">{selected.description}</p>
                <label className="field library-readonly-field">
                  <span className="field-label">Installation status</span>
                  <textarea
                    className="textarea resize-none"
                    readOnly
                    value={selected.detail}
                    rows={3}
                  />
                </label>
              </>
            )}
            {detail === 'source' && (
              <>
                <label className="field">
                  <span className="field-label">Publisher and license</span>
                  <input
                    className="input"
                    readOnly
                    value={`${selected.source.repository} · ${selected.source.license}`}
                  />
                </label>
                <label className="field library-readonly-field">
                  <span className="field-label">Source and pinned revision</span>
                  <textarea
                    className="textarea resize-none"
                    readOnly
                    rows={3}
                    value={`${selected.source.url}\nRevision: ${selected.source.revision}\nVersion: ${selected.version}`}
                  />
                </label>
              </>
            )}
            {detail === 'access' && (
              <>
                <div className="library-detail-records">
                  {detailItems.length ? (
                    detailItems
                      .slice(
                        currentDetailPage * detailPageSize,
                        (currentDetailPage + 1) * detailPageSize,
                      )
                      .map((item, index) => (
                        <label
                          className="field library-readonly-field"
                          key={`${detailPage}:${index}`}
                        >
                          <span className="field-label">{item.label}</span>
                          <textarea
                            className="textarea resize-none"
                            readOnly
                            rows={2}
                            value={item.text}
                          />
                        </label>
                      ))
                  ) : (
                    <p className="inline-empty">No additional setup or access is declared.</p>
                  )}
                </div>
                <LibraryPagination
                  label="Setup and access pages"
                  page={currentDetailPage}
                  pages={detailPages}
                  count={detailItems.length}
                  onPage={setDetailPage}
                  pageSize={detailPageSize}
                  disabled={disabled}
                />
              </>
            )}
            {detail === 'tools' && (
              <>
                <div className="library-connection-actions">
                  <label>
                    <span className="sr-only">Project for MCP connection check</span>
                    <select
                      className="select"
                      value={projectId}
                      disabled={disabled}
                      onChange={(event) => {
                        request.current = undefined
                        setProjectId(event.target.value)
                        setInspection(undefined)
                      }}
                    >
                      <option value="">No project folder</option>
                      {workspace.state?.projects
                        .filter((project) => project.folderPath)
                        .map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    className="button secondary"
                    disabled={disabled || selected.state !== 'installed'}
                    onClick={() => void inspect(selected)}
                  >
                    Check connection
                  </button>
                </div>
                <p className="library-connection-status" role="status">
                  {inspection
                    ? `${inspection.connected ? 'Connected' : 'Not connected'} · ${inspection.detail}`
                    : selected.state !== 'installed'
                      ? 'Complete the requirements in Setup & access before checking this connection.'
                      : projectId
                        ? 'An explicit check starts this server briefly and lists tools. No tools are run.'
                        : 'Choose a saved project for folder-based servers. A check briefly starts the server and lists tools; no tools are run.'}
                </p>
                <div className="library-detail-records library-tool-records">
                  {detailItems
                    .slice(
                      currentDetailPage * detailPageSize,
                      (currentDetailPage + 1) * detailPageSize,
                    )
                    .map((item, index) => (
                      <label
                        className="field library-readonly-field"
                        key={`${detailPage}:${index}`}
                      >
                        <span className="field-label">{item.label}</span>
                        <textarea
                          className="textarea resize-none"
                          readOnly
                          rows={2}
                          value={item.text}
                        />
                      </label>
                    ))}
                  {inspection?.connected && !detailItems.length && (
                    <p className="inline-empty">The server reported no tools.</p>
                  )}
                </div>
                <LibraryPagination
                  label="MCP tool pages"
                  page={currentDetailPage}
                  pages={detailPages}
                  count={detailItems.length}
                  onPage={setDetailPage}
                  pageSize={detailPageSize}
                  disabled={disabled}
                />
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="library-filters">
            <label className="library-search">
              <span className="sr-only">Search installed library</span>
              <input
                ref={searchInput}
                className="input"
                placeholder="Search tools, languages, workflows…"
                value={query}
                maxLength={120}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(0)
                }}
              />
            </label>
            {query && (
              <button
                className="button ghost library-clear"
                aria-label="Clear library search"
                onClick={() => {
                  setQuery('')
                  setPage(0)
                  searchInput.current?.focus()
                }}
              >
                <Icon name="close" size={14} />
              </button>
            )}
            <label>
              <span className="sr-only">Library type</span>
              <select
                className="select"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value)
                  setPage(0)
                }}
              >
                <option value="all">All types</option>
                <option value="skill">Skills</option>
                <option value="mcp">MCPs</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Library category</span>
              <select
                className="select"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value)
                  setPage(0)
                }}
              >
                <option value="all">All categories</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Library installation status</span>
              <select
                className="select"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value)
                  setPage(0)
                }}
              >
                <option value="all">All statuses</option>
                {Object.entries(stateLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            ref={list}
            className="library-list"
            aria-live="polite"
            style={
              {
                '--library-visible-rows': pageSize,
                '--library-row-height': `${listLayout.rowHeight}px`,
              } as CSSProperties
            }
          >
            {filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((entry) => (
              <article className="panel library-entry" key={entry.id}>
                <div className="library-entry-heading">
                  <h2>{entry.name}</h2>
                  <span className="badge">{entry.kind === 'mcp' ? 'MCP' : 'Skill'}</span>
                  <span className="library-entry-status">{stateLabels[entry.state]}</span>
                </div>
                <p title={entry.description}>{entry.description}</p>
                <div className="library-entry-footer">
                  <span>
                    {entry.category} · {entry.version}
                  </span>
                  <button
                    className="button ghost"
                    data-library-entry={entry.id}
                    disabled={disabled}
                    onClick={() => select(entry)}
                  >
                    View details
                  </button>
                </div>
              </article>
            ))}
            {!filtered.length && (
              <EmptyState
                icon="catalog"
                title={entries.length ? 'No matching tools' : 'Tool library'}
              >
                {entries.length
                  ? 'Change your search or filters to see more tools.'
                  : checked
                    ? 'Refresh the library to check installed packages.'
                    : 'Loading installed packages…'}
              </EmptyState>
            )}
          </div>
          <LibraryPagination
            label="Installed library pages"
            page={currentPage}
            pages={pageCount}
            count={filtered.length}
            onPage={setPage}
            pageSize={pageSize}
          />
        </>
      )}
    </section>
  )
}

function LibraryPagination({
  label,
  page,
  pages,
  count,
  onPage,
  pageSize,
  disabled = false,
}: {
  label: string
  page: number
  pages: number
  count: number
  onPage: (page: number) => void
  pageSize: number
  disabled?: boolean
}): JSX.Element {
  return (
    <nav className="compact-pagination library-pagination" aria-label={label}>
      <span className="library-page-count">
        {count ? page * pageSize + 1 : 0}–{Math.min(count, (page + 1) * pageSize)} of {count}
      </span>
      <button
        className="button ghost"
        disabled={disabled || page === 0}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span>
        {page + 1} / {pages}
      </span>
      <button
        className="button ghost"
        disabled={disabled || page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  )
}
