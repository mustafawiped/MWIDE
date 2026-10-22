import { useState } from 'react'
import type { FormEvent, JSX } from 'react'
import type { CatalogItem, ProjectDraft, Recommendation } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'
import { Icon } from './ui'

export function ProjectEditor({
  initial,
  catalog,
  workspace,
  onSave,
  onCancel,
  editing = false,
}: {
  initial: ProjectDraft
  catalog: CatalogItem[]
  workspace: WorkspaceController
  onSave: (draft: ProjectDraft) => Promise<void>
  onCancel: () => void
  editing?: boolean
}): JSX.Element {
  const [draft, setDraft] = useState<ProjectDraft>(() => ({
    ...initial,
    catalogIds: [...initial.catalogIds],
  }))
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [recommendationDone, setRecommendationDone] = useState(false)
  const disabled = workspace.pending || Boolean(workspace.generatingId)
  const setField = (field: 'name' | 'description' | 'rules' | 'architecture', value: string) => {
    workspace.markDirty('project', true)
    setDraft((previous) => ({ ...previous, [field]: value }))
  }
  const toggle = (id: string) => {
    workspace.markDirty('project', true)
    setDraft((previous) => ({
      ...previous,
      catalogIds: previous.catalogIds.includes(id)
        ? previous.catalogIds.filter((value) => value !== id)
        : [...previous.catalogIds, id],
    }))
  }
  const recommend = async () => {
    const items = await workspace.execute((bridge) => bridge.recommend(draft))
    if (items) {
      const valid = items.filter((item) => catalog.some((entry) => entry.id === item.id))
      setRecommendations(valid)
      setRecommendationDone(true)
      if (valid.length > 0) workspace.markDirty('project', true)
      setDraft((previous) => ({
        ...previous,
        catalogIds: [...new Set([...previous.catalogIds, ...valid.map((item) => item.id)])],
      }))
    }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (draft.name.trim() && draft.description.trim())
      void onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim() })
  }
  return (
    <form className="project-editor" onSubmit={submit}>
      <fieldset disabled={disabled} className="editor-grid">
        <div className="panel form-panel">
          <div className="section-heading">
            <h2>Project context</h2>
            <p>A clear brief gives every conversation a useful starting point.</p>
          </div>
          <label className="field">
            <span className="field-label">
              Project name <span className="required">*</span>
            </span>
            <input
              className="input"
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => setField('name', event.target.value)}
              placeholder="A name for your next idea"
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">
              Description <span className="required">*</span>
            </span>
            <textarea
              className="textarea"
              required
              rows={4}
              value={draft.description}
              onChange={(event) => setField('description', event.target.value)}
              placeholder="What are you building, and who is it for?"
            />
          </label>
          <label className="field">
            <span className="field-label">
              Additional rules <span className="optional">Optional</span>
            </span>
            <textarea
              className="textarea"
              rows={3}
              value={draft.rules}
              onChange={(event) => setField('rules', event.target.value)}
              placeholder="Conventions, constraints, and things to keep in mind"
            />
          </label>
          <label className="field">
            <span className="field-label">
              Architecture notes <span className="optional">Optional</span>
            </span>
            <textarea
              className="textarea"
              rows={3}
              value={draft.architecture}
              onChange={(event) => setField('architecture', event.target.value)}
              placeholder="Not decided yet"
            />
          </label>
        </div>
        <div className="panel catalog-choice">
          <div className="section-heading">
            <h2>MCPs & Skills</h2>
            <p>Select the catalog instructions to include in this project.</p>
          </div>
          <button
            className="button secondary full-width"
            type="button"
            disabled={!draft.description.trim()}
            onClick={() => void recommend()}
          >
            <Icon name="sparkles" size={16} />
            {workspace.pending ? 'Working…' : 'Recommend MCPs & Skills'}
          </button>
          <p className="hint">
            Uses your default provider and model. Recommendations select matching entries; you can
            change the selection.
          </p>
          {catalog.length === 0 ? (
            <p className="inline-empty">
              Your catalog is empty. Add MCPs or skills in Catalog to make them available here.
            </p>
          ) : (
            <div className="catalog-options">
              {catalog.map((item) => (
                <label key={item.id} className="catalog-option">
                  <input
                    type="checkbox"
                    checked={draft.catalogIds.includes(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span>
                    <span className="catalog-option-title">
                      {item.name}
                      <span className="badge">{item.kind === 'mcp' ? 'MCP' : 'Skill'}</span>
                    </span>
                    <span className="catalog-option-description">{item.description}</span>
                    {recommendations.find((entry) => entry.id === item.id)?.reason && (
                      <span className="recommendation">
                        {recommendations.find((entry) => entry.id === item.id)?.reason}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          {recommendationDone && recommendations.length === 0 && (
            <p className="notice">No matching catalog entries were recommended.</p>
          )}
          <div className="context-tip">
            <Icon name="sparkles" size={18} />
            <p>
              Keep useful context close.
              <br />
              <span>Your brief and selected instructions accompany each chat.</span>
            </p>
          </div>
        </div>
      </fieldset>
      <div className="form-actions">
        <button className="button ghost" type="button" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
        <button
          className="button primary"
          type="submit"
          disabled={disabled || !draft.name.trim() || !draft.description.trim()}
        >
          {workspace.pending ? 'Saving…' : editing ? 'Save project context' : 'Create project'}
        </button>
      </div>
    </form>
  )
}
