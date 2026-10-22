import { useState } from 'react'
import type { JSX } from 'react'
import type { ProjectDraft } from '../../shared/contracts'
import { useWorkspace } from './useWorkspace'
import { Brand, ConfirmDialog, EmptyState, Icon, PageHeading } from './ui'
import type { IconName } from './ui'
import { ProjectEditor } from './ProjectEditor'
import { ProvidersPage } from './ProvidersPage'
import { CatalogPage } from './CatalogPage'
import { ChatWorkspace } from './ChatWorkspace'
type Page = 'projects' | 'catalog' | 'providers'
const emptyProject: ProjectDraft = {
  name: '',
  description: '',
  rules: '',
  architecture: '',
  catalogIds: [],
}

export default function App(): JSX.Element {
  const workspace = useWorkspace()
  const [page, setPage] = useState<Page>('projects')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectForm, setProjectForm] = useState<'new' | 'edit' | null>(null)
  const projects = workspace.state?.projects ?? []
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const locked = Boolean(workspace.generatingId) || workspace.pending
  const settings = workspace.state?.settings
  const model = settings?.defaultProvider === 'ollama' ? settings.ollamaModel : settings?.codexModel
  const navigate = async (next: Page) => {
    if (!(await workspace.confirmDiscard())) return
    setPage(next)
    setProjectForm(null)
    setSelectedProjectId(null)
    workspace.clearError()
  }
  const saveProject = async (draft: ProjectDraft) => {
    const next = await workspace.mutate((bridge) =>
      projectForm === 'edit' && selectedProject
        ? bridge.updateProject({ ...selectedProject, ...draft })
        : bridge.createProject(draft),
    )
    if (next) {
      workspace.markDirty('project', false)
      if (projectForm === 'new') {
        const created = next.projects.find(
          (project) => !projects.some((previous) => previous.id === project.id),
        )
        if (created) setSelectedProjectId(created.id)
      }
      setProjectForm(null)
    }
  }
  const nav: { id: Page; label: string; icon: IconName; caption: string }[] = [
    { id: 'projects', label: 'Projects', icon: 'projects', caption: 'Your work, in context' },
    { id: 'catalog', label: 'Catalog', icon: 'catalog', caption: 'MCPs & Skills' },
    { id: 'providers', label: 'Providers', icon: 'providers', caption: 'Models & connections' },
  ]
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="app-shell">
        <aside className="sidebar" aria-label="Main navigation">
          <Brand />
          <p className="nav-label">WORKSPACE</p>
          <nav>
            {nav.map((item) => (
              <button
                className={`nav-item ${page === item.id ? 'nav-active' : ''}`}
                key={item.id}
                aria-current={page === item.id ? 'page' : undefined}
                disabled={locked}
                onClick={() => void navigate(item.id)}
              >
                <Icon name={item.icon} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.caption}</small>
                </span>
                {page === item.id && <span className="nav-active-dot" aria-hidden="true" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className="footer-label">DEFAULT MODEL</span>
            <strong>
              {settings
                ? settings.defaultProvider === 'ollama'
                  ? 'Ollama'
                  : 'ChatGPT / Codex'
                : 'Not configured'}
            </strong>
            <span>{model || 'Choose a model in Providers'}</span>
            <span className="sidebar-wordmark">A little more focus.</span>
          </div>
        </aside>
        <main id="main-content" className="main-panel" tabIndex={-1}>
          {!workspace.available && (
            <div className="preview-banner" role="status">
              <span className="badge">Preview</span>
              <span>
                The workspace service is not connected. Explore the interface; saving and AI actions
                are unavailable.
              </span>
            </div>
          )}
          {workspace.error && (
            <div className="error global-error" role="alert">
              <span>{workspace.error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={workspace.clearError}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {workspace.pending && (
            <div className="operation-bar" role="status">
              <span>{workspace.operationCancelling ? 'Cancelling…' : 'Working…'}</span>
              <button
                className="button ghost"
                disabled={workspace.operationCancelling}
                onClick={() => void workspace.cancelOperation()}
              >
                {workspace.operationCancelling ? 'Cancellation requested' : 'Cancel'}
              </button>
            </div>
          )}
          {workspace.loading ? (
            <div className="loading-state" role="status">
              <span className="loading-ring" />
              Opening your workspace…
            </div>
          ) : page === 'catalog' ? (
            <CatalogPage workspace={workspace} />
          ) : page === 'providers' ? (
            <ProvidersPage workspace={workspace} />
          ) : projectForm ? (
            <div className="page-content">
              <PageHeading
                eyebrow={projectForm === 'edit' ? 'PROJECT SETTINGS' : 'A FRESH START'}
                title={projectForm === 'edit' ? 'Project context' : 'Create a project'}
                description="Give your ideas a place to grow, with context that stays close."
              />
              <ProjectEditor
                key={projectForm === 'edit' ? selectedProject?.id : 'new'}
                initial={projectForm === 'edit' && selectedProject ? selectedProject : emptyProject}
                catalog={workspace.state?.catalog ?? []}
                workspace={workspace}
                onSave={saveProject}
                onCancel={async () => {
                  if (await workspace.confirmDiscard()) setProjectForm(null)
                }}
                editing={projectForm === 'edit'}
              />
            </div>
          ) : selectedProject ? (
            <ChatWorkspace
              key={selectedProject.id}
              project={selectedProject}
              workspace={workspace}
              onBack={() => setSelectedProjectId(null)}
              onEdit={() => setProjectForm('edit')}
            />
          ) : (
            <div className="page-content">
              <PageHeading
                eyebrow="YOUR WORKSPACE"
                title="Projects"
                description="Every idea deserves a space of its own."
              >
                <button
                  className="button primary"
                  disabled={locked}
                  onClick={() => setProjectForm('new')}
                >
                  <Icon name="plus" size={17} />
                  New project
                </button>
              </PageHeading>
              {projects.length === 0 ? (
                <div className="projects-empty">
                  <EmptyState title="Everything starts with a project.">
                    Keep your brief, conversations, and chosen tools together.
                    <br />
                    Create your first project when you’re ready.
                  </EmptyState>
                  <button className="button secondary" onClick={() => setProjectForm('new')}>
                    Create your first project
                    <Icon name="arrow" size={15} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="list-toolbar">
                    <span className="eyebrow">ALL PROJECTS</span>
                    <span className="muted small">
                      {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                    </span>
                  </div>
                  <div className="card-grid">
                    {projects.map((project) => (
                      <button
                        className="project-card"
                        key={project.id}
                        disabled={locked}
                        onClick={() => setSelectedProjectId(project.id)}
                      >
                        <span className="project-card-icon">
                          <Icon name="projects" />
                        </span>
                        <h2>{project.name}</h2>
                        <p>{project.description}</p>
                        <div className="project-card-footer">
                          <span>
                            {project.catalogIds.length} catalog{' '}
                            {project.catalogIds.length === 1 ? 'entry' : 'entries'}
                          </span>
                          <Icon name="arrow" size={16} />
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>
      {workspace.discardRequested && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          onConfirm={() => workspace.resolveDiscard(true)}
          onCancel={() => workspace.resolveDiscard(false)}
        >
          Your changes to this form have not been saved. Discard them to continue.
        </ConfirmDialog>
      )}
    </>
  )
}
