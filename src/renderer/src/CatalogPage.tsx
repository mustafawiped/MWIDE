import { useState } from 'react'
import type { FormEvent, JSX } from 'react'
import type { CatalogItem, CatalogKind } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'
import { ConfirmDialog, EmptyState, Icon, PageHeading, Textarea } from './ui'
import { focusInvalidField } from './formValidation'
type CatalogDraft = Omit<CatalogItem, 'id'> & { id?: string }
const newItem = (): CatalogDraft => ({ kind: 'mcp', name: '', description: '', instructions: '' })

export function CatalogPage({ workspace }: { workspace: WorkspaceController }): JSX.Element {
  const catalog = workspace.state?.catalog ?? []
  const [draft, setDraftState] = useState<CatalogDraft | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | CatalogKind>('all')
  const [errors, setErrors] = useState<Record<string, string>>({})
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
    setErrors({})
  }
  const replaceDraft = async (next: CatalogDraft | null) => {
    if (await workspace.confirmDiscard()) setDraft(next)
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
      focusInvalidField(event.currentTarget, first)
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
    <div className="page-content">
      <PageHeading
        eyebrow="YOUR TOOLKIT"
        title="Catalog"
        description="Reusable instructions for the way you work."
      >
        <button
          className="button primary"
          disabled={disabled}
          onClick={() => void replaceDraft(newItem())}
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
        <form
          className="panel form-panel catalog-editor"
          noValidate
          onSubmit={(event) => void save(event)}
        >
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
                  name="name"
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Give this entry a clear name"
                  autoFocus
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
            <label className="field">
              <span className="field-label">Description</span>
              <Textarea
                className="textarea resize-none"
                name="description"
                required
                rows={2}
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
            <label className="field">
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
                aria-describedby={errors.instructions ? 'catalog-instructions-error' : undefined}
              />
              {errors.instructions && (
                <span className="field-error" id="catalog-instructions-error">
                  {errors.instructions}
                </span>
              )}
            </label>
            <div className="form-actions">
              <button
                className="button ghost"
                type="button"
                onClick={() => void replaceDraft(null)}
              >
                Cancel
              </button>
              <button className="button primary" type="submit">
                Save entry
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
              </div>
              <div className="entry-actions">
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
