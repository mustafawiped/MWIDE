import { useState } from 'react'
import type { FormEvent, JSX } from 'react'
import type { CatalogItem, ProjectDraft, Recommendation } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'
import { Icon, Textarea } from './ui'
import { focusInvalidField } from './formValidation'
import { CompactTabs } from './CompactTabs'
import { ProjectCodeIndex } from './ProjectCodeIndex'
import './chat-controls.css'

type ProjectSection = 'brief' | 'folder' | 'index' | 'rules' | 'architecture' | 'toolkit'
const catalogPageSize = 2

export function ProjectEditor({
  initial,
  catalog,
  workspace,
  onSave,
  onCancel,
  editing = false,
  projectId,
}: {
  initial: ProjectDraft
  catalog: CatalogItem[]
  workspace: WorkspaceController
  onSave: (draft: ProjectDraft) => Promise<void>
  onCancel: () => void
  editing?: boolean
  projectId?: string
}): JSX.Element {
  const [draft, setDraft] = useState<ProjectDraft>(() => ({
    ...initial,
    catalogIds: [...initial.catalogIds],
  }))
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [recommendationDone, setRecommendationDone] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<ProjectSection>('brief')
  const [catalogPage, setCatalogPage] = useState(0)
  const disabled = workspace.pending || Boolean(workspace.generatingId)
  const pageCount = Math.max(1, Math.ceil(catalog.length / catalogPageSize))
  const currentPage = Math.min(catalogPage, pageCount - 1)
  const visibleCatalog = catalog.slice(
    currentPage * catalogPageSize,
    (currentPage + 1) * catalogPageSize,
  )
  const updateDraft = (next: ProjectDraft) => {
    setDraft(next)
    workspace.markDirty(
      'project',
      next.name !== initial.name ||
        next.description !== initial.description ||
        next.rules !== initial.rules ||
        next.architecture !== initial.architecture ||
        (next.folderPath || '') !== (initial.folderPath || '') ||
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
  const chooseFolder = async () => {
    const folderPath = await workspace.execute((bridge) => bridge.selectProjectFolder())
    if (folderPath) updateDraft({ ...draft, folderPath })
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
      const form = event.currentTarget
      setActiveTab('brief')
      requestAnimationFrame(() => focusInvalidField(form, first))
      return
    }
    void onSave({ ...draft, name: draft.name.trim() })
  }
  return (
    <form className="project-editor compact-editor" noValidate onSubmit={submit}>
      <CompactTabs
        id="project"
        label="Project context sections"
        selected={activeTab}
        onSelect={setActiveTab}
        disabled={disabled}
        tabs={[
          { value: 'brief', label: 'Brief', invalid: Boolean(errors.name || errors.description) },
          { value: 'folder', label: 'Folder' },
          { value: 'index', label: 'Code index' },
          { value: 'rules', label: 'Rules' },
          { value: 'architecture', label: 'Architecture' },
          { value: 'toolkit', label: 'MCPs & Skills' },
        ]}
      />
      <fieldset disabled={disabled} className="editor-grid">
        {activeTab === 'brief' && (
          <div
            className="panel form-panel editor-section"
            id="project-panel-brief"
            role="tabpanel"
            aria-labelledby="project-tab-brief"
          >
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
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'project-name-error' : undefined}
              />
              {errors.name && (
                <span className="field-error" id="project-name-error">
                  {errors.name}
                </span>
              )}
            </label>
            <label className="field expanding-field">
              <span className="field-label">
                Description <span className="required">*</span>
              </span>
              <Textarea
                className="textarea resize-none"
                name="description"
                required
                rows={3}
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
          </div>
        )}
        {activeTab === 'folder' && (
          <div
            className="panel form-panel editor-section project-folder-panel"
            id="project-panel-folder"
            role="tabpanel"
            aria-labelledby="project-tab-folder"
          >
            <div className="section-heading">
              <h2>Project folder</h2>
              <p>Give new conversations a current map of your codebase.</p>
            </div>
            <p className="project-folder-path" title={draft.folderPath || undefined}>
              {draft.folderPath || 'No folder selected'}
            </p>
            <div className="project-folder-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void chooseFolder()}
              >
                <Icon name="projects" size={15} />
                {draft.folderPath ? 'Change folder' : 'Choose folder'}
              </button>
              {draft.folderPath && (
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => updateDraft({ ...draft, folderPath: undefined })}
                >
                  Remove folder
                </button>
              )}
            </div>
            <p className="project-folder-description">
              MWIDE refreshes the file map and static TypeScript / JavaScript symbols and calls for
              chats, then shares relevant evidence with your selected AI. Other languages include
              file paths only. Dependencies, ignored files, and common secret files are excluded.
            </p>
          </div>
        )}
        {activeTab === 'index' && (
          <ProjectCodeIndex
            projectId={projectId}
            folderPath={draft.folderPath}
            folderSaved={(draft.folderPath || '') === (initial.folderPath || '')}
            workspace={workspace}
          />
        )}
        {activeTab === 'rules' && (
          <div
            className="panel form-panel editor-section"
            id="project-panel-rules"
            role="tabpanel"
            aria-labelledby="project-tab-rules"
          >
            <div className="section-heading">
              <h2>Additional rules</h2>
              <p>Conventions and constraints that accompany every conversation.</p>
            </div>
            <label className="field expanding-field">
              <span className="field-label">
                Additional rules <span className="optional">Optional</span>
              </span>
              <Textarea
                className="textarea resize-none"
                rows={5}
                maxLength={12_000}
                name="rules"
                value={draft.rules}
                onChange={(event) => setField('rules', event.target.value)}
                placeholder="Conventions, constraints, and things to keep in mind"
              />
            </label>
          </div>
        )}
        {activeTab === 'architecture' && (
          <div
            className="panel form-panel editor-section"
            id="project-panel-architecture"
            role="tabpanel"
            aria-labelledby="project-tab-architecture"
          >
            <div className="section-heading">
              <h2>Architecture notes</h2>
              <p>Keep the project's complete technical context close to your chats.</p>
            </div>
            <label className="field expanding-field">
              <span className="field-label">
                Architecture notes <span className="optional">Optional</span>
              </span>
              <Textarea
                className="textarea resize-none"
                rows={5}
                maxLength={20_000}
                value={draft.architecture}
                name="architecture"
                onChange={(event) => setField('architecture', event.target.value)}
                placeholder="Not decided yet"
              />
            </label>
          </div>
        )}
        {activeTab === 'toolkit' && (
          <div
            className="panel catalog-choice editor-section"
            id="project-panel-toolkit"
            role="tabpanel"
            aria-labelledby="project-tab-toolkit"
          >
            <div className="section-heading">
              <h2>MCPs & Skills</h2>
              <p>{draft.catalogIds.length} selected. These instructions accompany each chat.</p>
            </div>
            <div className="catalog-choice-actions">
              <button
                className="button secondary"
                type="button"
                disabled={!draft.name.trim() || !draft.description.trim() || catalog.length === 0}
                onClick={() => void recommend()}
              >
                <Icon name="sparkles" size={16} />
                Recommend MCPs & Skills
              </button>
              {recommendations.length > 0 && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={recommendations.every((item) => draft.catalogIds.includes(item.id))}
                  onClick={applyRecommendations}
                >
                  {recommendations.every((item) => draft.catalogIds.includes(item.id))
                    ? 'Recommendations selected'
                    : 'Apply recommendations'}
                </button>
              )}
            </div>
            <p className="hint">
              Uses your default provider and model. Apply suggestions to select them.
            </p>
            {catalog.length === 0 ? (
              <p className="inline-empty">
                Your catalog is empty. Add MCPs or skills in Catalog to make them available here.
              </p>
            ) : (
              <div className="catalog-options">
                {visibleCatalog.map((item) => (
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
            {catalog.length > catalogPageSize && (
              <nav className="compact-pagination" aria-label="Project catalog pages">
                <button
                  className="button ghost"
                  type="button"
                  disabled={currentPage === 0}
                  onClick={() => setCatalogPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span className="hint" aria-live="polite">
                  {currentPage + 1} / {pageCount}
                </span>
                <button
                  className="button ghost"
                  type="button"
                  disabled={currentPage === pageCount - 1}
                  onClick={() => setCatalogPage(currentPage + 1)}
                >
                  Next
                </button>
              </nav>
            )}
            {recommendationDone && recommendations.length === 0 && (
              <p className="notice">No matching catalog entries were recommended.</p>
            )}
          </div>
        )}
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
