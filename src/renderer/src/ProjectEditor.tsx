import { useState } from 'react'
import type { FormEvent, JSX } from 'react'
import type { CatalogItem, ProjectDraft, Recommendation } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'
import { Icon, Textarea } from './ui'
import { focusInvalidField } from './formValidation'

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
  const [errors, setErrors] = useState<Record<string, string>>({})
  const disabled = workspace.pending || Boolean(workspace.generatingId)
  const updateDraft = (next: ProjectDraft) => {
    setDraft(next)
    workspace.markDirty(
      'project',
      next.name !== initial.name ||
        next.description !== initial.description ||
        next.rules !== initial.rules ||
        next.architecture !== initial.architecture ||
        next.catalogIds.length !== initial.catalogIds.length ||
        next.catalogIds.some((id) => !initial.catalogIds.includes(id)),
    )
  }
  const setField = (field: 'name' | 'description' | 'rules' | 'architecture', value: string) => {
    updateDraft({ ...draft, [field]: value })
    setErrors((previous) => ({ ...previous, [field]: '' }))
    setRecommendations([])
    setRecommendationDone(false)
  }
  const toggle = (id: string) => {
    updateDraft({
      ...draft,
      catalogIds: draft.catalogIds.includes(id)
        ? draft.catalogIds.filter((value) => value !== id)
        : [...draft.catalogIds, id],
    })
  }
  const recommend = async () => {
    const items = await workspace.execute((bridge) => bridge.recommend(draft))
    if (items) {
      const valid = items.filter((item) => catalog.some((entry) => entry.id === item.id))
      setRecommendations(valid)
      setRecommendationDone(true)
    }
  }
  const applyRecommendations = () => {
    updateDraft({
      ...draft,
      catalogIds: [...new Set([...draft.catalogIds, ...recommendations.map((item) => item.id)])],
    })
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return
    const nextErrors: Record<string, string> = {}
    if (!draft.name.trim()) nextErrors.name = 'Enter a project name.'
    if (!draft.description.trim()) nextErrors.description = 'Describe what this project aims to do.'
    setErrors(nextErrors)
    const first = Object.keys(nextErrors)[0]
    if (first) {
      focusInvalidField(event.currentTarget, first)
      return
    }
    void onSave({ ...draft, name: draft.name.trim() })
  }
  return (
    <form className="project-editor" noValidate onSubmit={submit}>
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
              name="name"
              required
              maxLength={120}
              value={draft.name}
              onChange={(event) => setField('name', event.target.value)}
              placeholder="A name for your next idea"
              autoFocus
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'project-name-error' : undefined}
            />
            {errors.name && (
              <span className="field-error" id="project-name-error">
                {errors.name}
              </span>
            )}
          </label>
          <label className="field">
            <span className="field-label">
              Description <span className="required">*</span>
            </span>
            <Textarea
              className="textarea resize-none"
              name="description"
              required
              rows={4}
              maxLength={20_000}
              value={draft.description}
              onChange={(event) => setField('description', event.target.value)}
              placeholder="What are you building, and who is it for?"
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? 'project-description-error' : undefined}
            />
            {errors.description && (
              <span className="field-error" id="project-description-error">
                {errors.description}
              </span>
            )}
          </label>
          <label className="field">
            <span className="field-label">
              Additional rules <span className="optional">Optional</span>
            </span>
            <Textarea
              className="textarea resize-none"
              rows={3}
              maxLength={12_000}
              name="rules"
              value={draft.rules}
              onChange={(event) => setField('rules', event.target.value)}
              placeholder="Conventions, constraints, and things to keep in mind"
            />
          </label>
          <label className="field">
            <span className="field-label">
              Architecture notes <span className="optional">Optional</span>
            </span>
            <Textarea
              className="textarea resize-none"
              rows={3}
              maxLength={20_000}
              value={draft.architecture}
              name="architecture"
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
            disabled={!draft.name.trim() || !draft.description.trim() || catalog.length === 0}
            onClick={() => void recommend()}
          >
            <Icon name="sparkles" size={16} />
            Recommend MCPs & Skills
          </button>
          <p className="hint">
            Uses your default provider and model. Review the suggestions, then apply the ones you
            want.
          </p>
          {recommendations.length > 0 && (
            <button
              className="button secondary full-width"
              type="button"
              disabled={recommendations.every((item) => draft.catalogIds.includes(item.id))}
              onClick={applyRecommendations}
            >
              {recommendations.every((item) => draft.catalogIds.includes(item.id))
                ? 'Recommendations selected'
                : 'Apply recommendations'}
            </button>
          )}
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
        <button className="button primary" type="submit" disabled={disabled}>
          {editing ? 'Save project context' : 'Create project'}
        </button>
      </div>
    </form>
  )
}
