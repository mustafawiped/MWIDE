import { useState } from 'react'
import type { FormEvent, JSX } from 'react'
import type { CatalogItem, CatalogKind } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'
import { EmptyState, Icon, PageHeading } from './ui'
type CatalogDraft = Omit<CatalogItem, 'id'> & { id?: string }
const newItem = (): CatalogDraft => ({ kind: 'mcp', name: '', description: '', instructions: '' })

export function CatalogPage({ workspace }: { workspace: WorkspaceController }): JSX.Element {
  const catalog = workspace.state?.catalog ?? []
  const [draft, setDraftState] = useState<CatalogDraft | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | CatalogKind>('all')
  const disabled = workspace.pending || Boolean(workspace.generatingId)
  const filtered = catalog.filter((item) => filter === 'all' || item.kind === filter)
  const setDraft = (next: CatalogDraft | null) => {
    const original = catalog.find((item) => item.id === next?.id)
    const dirty =
      next !== null &&
      (next.name !== (original?.name ?? '') ||
        next.description !== (original?.description ?? '') ||
        next.instructions !== (original?.instructions ?? '') ||
        next.kind !== (original?.kind ?? 'mcp'))
    workspace.markDirty('catalog', dirty)
    setDraftState(next)
  }
  const replaceDraft = (next: CatalogDraft | null) => {
    if (workspace.confirmDiscard()) setDraft(next)
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft || !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim())
      return
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
    <div className="page-content">
      <PageHeading
        eyebrow="YOUR TOOLKIT"
        title="Catalog"
        description="Reusable instructions for the way you work."
      >
        <button
          className="button primary"
          disabled={disabled}
          onClick={() => replaceDraft(newItem())}
        >
          <Icon name="plus" size={17} />
          Add entry
        </button>
      </PageHeading>
      <div className="notice subtle">
        <Icon name="catalog" size={17} />
        <span>Selected skills provide instructions. MCP tool execution is not enabled yet.</span>
      </div>
      {draft && (
        <form className="panel form-panel catalog-editor" onSubmit={(event) => void save(event)}>
          <div className="section-heading">
            <h2>{draft.id ? 'Edit entry' : 'Add to your catalog'}</h2>
            <p>Describe when this entry is useful and how it should be used.</p>
          </div>
          <fieldset disabled={disabled}>
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
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Give this entry a clear name"
                  autoFocus
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Description</span>
              <textarea
                className="textarea"
                required
                rows={2}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="When would this be useful?"
              />
            </label>
            <label className="field">
              <span className="field-label">Instructions</span>
              <textarea
                className="textarea"
                required
                rows={5}
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                placeholder="Instructions to include in selected projects"
              />
            </label>
            <div className="form-actions">
              <button className="button ghost" type="button" onClick={() => replaceDraft(null)}>
                Cancel
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={
                  !draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()
                }
              >
                {workspace.pending ? 'Saving…' : 'Save entry'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <div className="list-toolbar">
        <div className="segmented-control" aria-label="Filter catalog">
          {(['all', 'mcp', 'skill'] as const).map((value) => (
            <button
              key={value}
              className={filter === value ? 'selected' : ''}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === 'all' ? 'All entries' : value === 'mcp' ? 'MCPs' : 'Skills'}
            </button>
          ))}
        </div>
        <span className="muted small">
          {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="catalog" title="A toolkit that feels like yours.">
          Add your first MCP or skill to build a library of reusable instructions.
        </EmptyState>
      ) : (
        <div className="catalog-list">
          {filtered.map((item) => (
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
                <details>
                  <summary>View instructions</summary>
                  <pre className="instruction-text">{item.instructions}</pre>
                </details>
                {removingId === item.id && (
                  <div className="remove-confirm">
                    <span>Remove this entry from your catalog?</span>
                    <button
                      className="button danger"
                      disabled={disabled}
                      onClick={() => void remove(item.id)}
                    >
                      Remove
                    </button>
                    <button
                      className="button ghost"
                      disabled={disabled}
                      onClick={() => setRemovingId(null)}
                    >
                      Keep entry
                    </button>
                  </div>
                )}
              </div>
              <div className="entry-actions">
                <button
                  className="button ghost"
                  disabled={disabled}
                  onClick={() => {
                    replaceDraft({ ...item })
                    setRemovingId(null)
                  }}
                >
                  Edit
                </button>
                <button
                  className="button ghost danger-text"
                  disabled={disabled}
                  onClick={() => setRemovingId(item.id)}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
