import { useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import type { CatalogItem, CatalogKind } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'
import { ConfirmDialog, EmptyState, Icon, PageHeading, Textarea } from './ui'
import { focusInvalidField } from './formValidation'
import { CompactTabs } from './CompactTabs'
import { ToolLibraryPanel } from './ToolLibraryPanel'
type CatalogDraft = Omit<CatalogItem, 'id'> & { id?: string }
type CatalogSection = 'details' | 'instructions'
const newItem = (): CatalogDraft => ({ kind: 'mcp', name: '', description: '', instructions: '' })
const pageSize = 2

export function CatalogPage({ workspace }: { workspace: WorkspaceController }): JSX.Element {
  const catalog = workspace.state?.catalog ?? []
  const [draft, setDraftState] = useState<CatalogDraft | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | CatalogKind>('all')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<CatalogSection>('details')
  const [page, setPage] = useState(0)
  const [view, setView] = useState<'catalog' | 'library'>('catalog')
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const disabled = workspace.pending || Boolean(workspace.generatingId)
  const normalizedQuery = query.trim().toLocaleLowerCase('en')
  const filtered = catalog.filter(
    (item) =>
      (filter === 'all' || item.kind === filter) &&
      (!normalizedQuery ||
        `${item.name} ${item.description}`.toLocaleLowerCase('en').includes(normalizedQuery)),
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleItems = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const setDraft = (next: CatalogDraft | null) => {
    const original = catalog.find((item) => item.id === next?.id)
    const dirty =
      next !== null &&
      !next.libraryId &&
      (next.name !== (original?.name ?? '') ||
        next.description !== (original?.description ?? '') ||
        next.instructions !== (original?.instructions ?? '') ||
        next.kind !== (original?.kind ?? 'mcp'))
    workspace.markDirty('catalog', dirty)
    setDraftState(next)
    setErrors({})
  }
  const replaceDraft = async (next: CatalogDraft | null, section: CatalogSection = 'details') => {
    if (await workspace.confirmDiscard()) {
      setDraft(next)
      setActiveTab(section)
    }
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft || disabled) return
    const nextErrors: Record<string, string> = {}
    if (!draft.name.trim()) nextErrors.name = 'Enter a catalog entry name.'
    if (!draft.description.trim()) nextErrors.description = 'Describe when this entry is useful.'
    if (!draft.instructions.trim()) nextErrors.instructions = 'Add the instructions for this entry.'
    setErrors(nextErrors)
    const first = Object.keys(nextErrors)[0]
    if (first) {
      const form = event.currentTarget
      setActiveTab(first === 'instructions' ? 'instructions' : 'details')
      requestAnimationFrame(() => focusInvalidField(form, first))
      return
    }
    const next = await workspace.mutate((bridge) =>
      bridge.saveCatalogItem({
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        instructions: draft.instructions.trim(),
      }),
    )
    if (next) setDraft(null)
  }
  const remove = async (id: string) => {
    const next = await workspace.mutate((bridge) => bridge.removeCatalogItem(id))
    if (next) setRemovingId(null)
  }
  return (
    <div className="page-content catalog-page">
      <PageHeading
        eyebrow="YOUR TOOLKIT"
        title="Catalog"
        description="Reusable instructions for the way you work."
      >
        {!draft && view === 'catalog' && (
          <button
            className="button primary"
            disabled={disabled}
            onClick={() => void replaceDraft(newItem())}
          >
            <Icon name="plus" size={17} />
            Add entry
          </button>
        )}
      </PageHeading>
      {!draft && (
        <CompactTabs
          id="catalog-view"
          label="Catalog views"
          tabs={[
            { value: 'catalog', label: 'Your catalog' },
            { value: 'library', label: 'Installed library' },
          ]}
          selected={view}
          onSelect={setView}
          disabled={disabled}
        />
      )}
      {!draft && view === 'library' && <ToolLibraryPanel workspace={workspace} />}
      {!draft && view === 'catalog' && (
        <div className="notice subtle">
          <Icon name="catalog" size={17} />
          <span>Selected skills provide instructions. MCP tool execution is not enabled yet.</span>
        </div>
      )}
      {draft?.libraryId && (
        <div className="panel catalog-managed-view">
          <div className="section-heading">
            <h2>{draft.name}</h2>
            <p>
              Installed library instructions are read-only. Source and setup details are in
              Installed library.
            </p>
          </div>
          <label className="field">
            <span className="field-label">Instructions</span>
            <textarea
              className="textarea resize-none"
              readOnly
              rows={6}
              value={draft.instructions}
            />
          </label>
          <div className="form-actions">
            <button className="button secondary" disabled={disabled} onClick={() => setDraft(null)}>
              Back to catalog
            </button>
          </div>
        </div>
      )}
      {draft && !draft.libraryId && (
        <form
          className="panel form-panel catalog-editor"
          noValidate
          onSubmit={(event) => void save(event)}
        >
          <div className="section-heading">
            <h2>{draft.id ? 'Edit entry' : 'Add to your catalog'}</h2>
            <p>Describe when this entry is useful and how it should be used.</p>
          </div>
          <CompactTabs
            id="catalog-entry"
            label="Catalog entry sections"
            selected={activeTab}
            onSelect={setActiveTab}
            disabled={disabled}
            tabs={[
              {
                value: 'details',
                label: 'Details',
                invalid: Boolean(errors.name || errors.description),
              },
              {
                value: 'instructions',
                label: 'Instructions',
                invalid: Boolean(errors.instructions),
              },
            ]}
          />
          <fieldset disabled={disabled} className="catalog-editor-fields">
            {activeTab === 'details' && (
              <div
                className="catalog-editor-section"
                id="catalog-entry-panel-details"
                role="tabpanel"
                aria-labelledby="catalog-entry-tab-details"
              >
                <div className="form-grid">
                  <label className="field">
                    <span className="field-label">Type</span>
                    <select
                      className="select"
                      value={draft.kind}
                      onChange={(event) =>
                        setDraft({ ...draft, kind: event.target.value as CatalogKind })
                      }
                    >
                      <option value="mcp">MCP</option>
                      <option value="skill">Skill</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">Name</span>
                    <input
                      className="input"
                      name="name"
                      required
                      maxLength={120}
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      placeholder="Give this entry a clear name"
                      aria-invalid={Boolean(errors.name)}
                      aria-describedby={errors.name ? 'catalog-name-error' : undefined}
                    />
                    {errors.name && (
                      <span className="field-error" id="catalog-name-error">
                        {errors.name}
                      </span>
                    )}
                  </label>
                </div>
                <label className="field expanding-field">
                  <span className="field-label">Description</span>
                  <Textarea
                    className="textarea resize-none"
                    name="description"
                    required
                    rows={3}
                    maxLength={4_000}
                    value={draft.description}
                    onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    placeholder="When would this be useful?"
                    aria-invalid={Boolean(errors.description)}
                    aria-describedby={errors.description ? 'catalog-description-error' : undefined}
                  />
                  {errors.description && (
                    <span className="field-error" id="catalog-description-error">
                      {errors.description}
                    </span>
                  )}
                </label>
              </div>
            )}
            {activeTab === 'instructions' && (
              <div
                className="catalog-editor-section"
                id="catalog-entry-panel-instructions"
                role="tabpanel"
                aria-labelledby="catalog-entry-tab-instructions"
              >
                <label className="field expanding-field">
                  <span className="field-label">Instructions</span>
                  <Textarea
                    className="textarea resize-none"
                    name="instructions"
                    required
                    rows={5}
                    maxLength={16_000}
                    value={draft.instructions}
                    onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                    placeholder="Instructions to include in selected projects"
                    aria-invalid={Boolean(errors.instructions)}
                    aria-describedby={
                      errors.instructions ? 'catalog-instructions-error' : undefined
                    }
                  />
                  {errors.instructions && (
                    <span className="field-error" id="catalog-instructions-error">
                      {errors.instructions}
                    </span>
                  )}
                </label>
              </div>
            )}
          </fieldset>
          <div className="form-actions catalog-editor-actions">
            <button
              className="button ghost"
              type="button"
              disabled={disabled}
              onClick={() => void replaceDraft(null)}
            >
              Cancel
            </button>
            <button className="button primary" type="submit" disabled={disabled}>
              Save entry
            </button>
          </div>
        </form>
      )}
      {!draft && view === 'catalog' && (
        <section
          className="catalog-own-panel"
          id="catalog-view-panel-catalog"
          role="tabpanel"
          aria-labelledby="catalog-view-tab-catalog"
        >
          <div className="list-toolbar">
            <div className="segmented-control" aria-label="Filter catalog">
              {(['all', 'mcp', 'skill'] as const).map((value) => (
                <button
                  key={value}
                  className={filter === value ? 'selected' : ''}
                  aria-pressed={filter === value}
                  onClick={() => {
                    setFilter(value)
                    setPage(0)
                  }}
                >
                  {value === 'all' ? 'All entries' : value === 'mcp' ? 'MCPs' : 'Skills'}
                </button>
              ))}
            </div>
            <div className="catalog-search">
              <label>
                <span className="sr-only">Search your catalog</span>
                <input
                  ref={searchInput}
                  className="input"
                  placeholder="Search your catalog…"
                  maxLength={120}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setPage(0)
                  }}
                />
              </label>
              {query && (
                <button
                  className="button ghost"
                  aria-label="Clear catalog search"
                  onClick={() => {
                    setQuery('')
                    setPage(0)
                    searchInput.current?.focus()
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
            <span className="muted small">
              {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              icon="catalog"
              title={catalog.length ? 'No matching entries' : 'A toolkit that feels like yours.'}
            >
              {catalog.length
                ? 'Change your search or type filter to see more entries.'
                : 'Add your first entry, or import installed tools from Installed library.'}
            </EmptyState>
          ) : (
            <div className="catalog-list compact-catalog-list">
              {visibleItems.map((item) => (
                <article className="panel catalog-entry" key={item.id}>
                  <div className="entry-icon">
                    <Icon name={item.kind === 'mcp' ? 'providers' : 'sparkles'} />
                  </div>
                  <div className="entry-content">
                    <div className="entry-title">
                      <h2>{item.name}</h2>
                      <span className="badge">{item.kind === 'mcp' ? 'MCP' : 'Skill'}</span>
                    </div>
                    <p>{item.description}</p>
                    <button
                      className="button ghost view-instructions"
                      disabled={disabled}
                      onClick={() => void replaceDraft({ ...item }, 'instructions')}
                    >
                      View instructions
                    </button>
                  </div>
                  <div className="entry-actions">
                    {!item.libraryId && (
                      <button
                        className="button ghost"
                        disabled={disabled}
                        onClick={() => {
                          void replaceDraft({ ...item })
                          setRemovingId(null)
                        }}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      className="button ghost danger-text"
                      disabled={disabled}
                      onClick={() => {
                        workspace.clearError()
                        setRemovingId(item.id)
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {filtered.length > pageSize && (
            <nav className="compact-pagination" aria-label="Catalog pages">
              <button
                className="button ghost"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>
              <span className="hint" aria-live="polite">
                {currentPage + 1} / {pageCount}
              </span>
              <button
                className="button ghost"
                disabled={currentPage === pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      )}
      {removingId && (
        <ConfirmDialog
          title={`Remove ${catalog.find((item) => item.id === removingId)?.name ?? 'catalog entry'}?`}
          confirmLabel="Remove entry"
          cancelLabel="Keep entry"
          busy={disabled}
          error={workspace.error}
          onConfirm={() => void remove(removingId)}
          onCancel={() => setRemovingId(null)}
        >
          This removes the entry from your catalog and project selections. Existing conversation
          history is kept.
        </ConfirmDialog>
      )}
    </div>
  )
}
