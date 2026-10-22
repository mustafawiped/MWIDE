import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectDraft } from '../../shared/contracts'
import { useWorkspace } from './useWorkspace'
import { Brand, ConfirmDialog, Icon, PageHeading } from './ui'
import type { IconName } from './ui'
import { ProjectEditor } from './ProjectEditor'
import { ProvidersPage } from './ProvidersPage'
import { CatalogPage } from './CatalogPage'
import { ChatWorkspace } from './ChatWorkspace'
import workspaceSymbol from './assets/mwide-symbol-black.svg'
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
  useEffect(() => {
    const title =
      projectForm === 'new'
        ? 'Create a project'
        : projectForm === 'edit'
          ? 'Project context'
          : (selectedProject?.name ??
            (page === 'catalog' ? 'Catalog' : page === 'providers' ? 'Providers' : 'Projects'))
    document.title = `${title} · MWIDE`
  }, [page, projectForm, selectedProject?.name])
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
  const openProject = async (id: string) => {
    if (!(await workspace.confirmDiscard())) return
    setPage('projects')
    setProjectForm(null)
    setSelectedProjectId(id)
    workspace.clearError()
  }
  const createProject = async () => {
    if (!(await workspace.confirmDiscard())) return
    setPage('projects')
    setSelectedProjectId(null)
    setProjectForm('new')
    workspace.clearError()
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
          <button
            className="button sidebar-create"
            disabled={locked || projectForm === 'new'}
            title={projectForm === 'new' ? 'A new project is already open' : undefined}
            onClick={() => void createProject()}
          >
            <Icon name="plus" size={17} />
            <span>New project</span>
          </button>
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
          <div className="sidebar-projects">
            <div className="sidebar-section-heading">
              <span className="nav-label">PROJECTS</span>
              <span className="utility-count">{projects.length}</span>
            </div>
            {projects.length ? (
              <div className="sidebar-project-list">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className={`sidebar-project ${selectedProjectId === project.id ? 'selected' : ''}`}
                    disabled={locked}
                    aria-current={selectedProjectId === project.id ? 'page' : undefined}
                    onClick={() => void openProject(project.id)}
                    title={project.name}
                  >
                    <Icon name="projects" size={15} />
                    <span>{project.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="sidebar-empty">A place for your next idea.</p>
            )}
          </div>
          <div className="sidebar-footer">
            <span className="footer-label">DEFAULT MODEL</span>
            <button
              className="model-switcher"
              disabled={locked}
              onClick={() => void navigate('providers')}
              aria-label="Configure the default model"
            >
              <span className="model-switcher-icon">
                <Icon name="terminal" size={17} />
              </span>
              <span>
                <strong>
                  {settings
                    ? settings.defaultProvider === 'ollama'
                      ? 'Ollama'
                      : 'ChatGPT / Codex'
                    : 'Not configured'}
                </strong>
                <small>{model || 'Choose a model'}</small>
              </span>
              <Icon name="chevronDown" size={14} />
            </button>
            <span className="sidebar-wordmark">
              <span aria-hidden="true">⌘</span> Easy MCP and Skill Management
            </span>
          </div>
        </aside>
        <main id="main-content" className="main-panel" tabIndex={-1}>
          <header className="app-topbar">
            <div className="workspace-path">
              <Icon name="terminal" size={16} />
              <span>workspace</span>
              <span className="path-separator">/</span>
              <strong>
                {page === 'catalog' ? 'catalog' : page === 'providers' ? 'providers' : 'projects'}
              </strong>
            </div>
            <span className="workspace-mode">
              MWIDE <span aria-hidden="true">·</span> Desktop workspace
            </span>
          </header>
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
                eyebrow={projectForm === 'edit' ? 'PROJECT SETTINGS' : 'NEW PROJECT'}
                title={projectForm === 'edit' ? 'Project context' : 'Create a project'}
                description="Set the purpose, rules, and tools for your conversations."
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
            <div className="page-content projects-page">
              <PageHeading
                eyebrow="YOUR WORKSPACE"
                title="Projects"
                description="Your projects, conversations, and tools. All in context."
              >
                <button
                  className="button primary"
                  disabled={locked}
                  onClick={() => void createProject()}
                >
                  <Icon name="plus" size={17} />
                  New project
                </button>
              </PageHeading>
              {projects.length === 0 ? (
                <div className="projects-empty">
                  <div className="workspace-welcome">
                    <img
                      className="welcome-symbol"
                      src={workspaceSymbol}
                      alt=""
                      width={54}
                      height={54}
                    />
                    <p className="welcome-kicker">A little more focus.</p>
                    <h2>What will you build next?</h2>
                    <p>
                      Start a project. Bring your context.
                      <br />
                      Keep the conversation moving.
                    </p>
                    <button
                      className="button primary welcome-create"
                      disabled={locked}
                      onClick={() => void createProject()}
                    >
                      <Icon name="plus" size={17} />
                      Create your first project
                    </button>
                  </div>
                  <div className="workspace-starters">
                    <button
                      className="starter-card"
                      disabled={locked}
                      onClick={() => void navigate('catalog')}
                    >
                      <Icon name="catalog" size={20} />
                      <span>
                        <strong>Make it your toolkit</strong>
                        <small>Organize your MCPs and Skills.</small>
                      </span>
                      <Icon name="arrow" size={15} />
                    </button>
                    <button
                      className="starter-card"
                      disabled={locked}
                      onClick={() => void navigate('providers')}
                    >
                      <Icon name="terminal" size={20} />
                      <span>
                        <strong>Choose your model</strong>
                        <small>Connect Codex or local Ollama.</small>
                      </span>
                      <Icon name="arrow" size={15} />
                    </button>
                  </div>
                  <p className="workspace-note">
                    <Icon name="projects" size={13} /> Project context stays with every
                    conversation.
                  </p>
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
          <footer className="workspace-status">
            <span>
              <span className="status-square" aria-hidden="true" />
              {workspace.available ? 'Local workspace' : 'Interface preview'}
            </span>
            <span>
              MCP <span aria-hidden="true">/</span> SKILLS <span aria-hidden="true">/</span> CONTEXT
            </span>
          </footer>
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
