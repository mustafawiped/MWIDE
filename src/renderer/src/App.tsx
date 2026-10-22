import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { ProjectDraft } from '../../shared/contracts'
import { useWorkspace } from './useWorkspace'
import { ConfirmDialog, Icon, PageHeading } from './ui'
import { ProjectEditor } from './ProjectEditor'
import { ProvidersPage } from './ProvidersPage'
import { CatalogPage } from './CatalogPage'
import { ChatWorkspace } from './ChatWorkspace'
import workspaceSymbol from './assets/mwide-symbol-black.svg'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import type { WorkspacePage } from './WorkspaceSidebar'
const emptyProject: ProjectDraft = {
  name: '',
  description: '',
  rules: '',
  architecture: '',
  catalogIds: [],
}

export default function App(): JSX.Element {
  const workspace = useWorkspace()
  const [page, setPage] = useState<WorkspacePage>('workspace')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectForm, setProjectForm] = useState<'new' | 'edit' | null>(null)
  const projects = workspace.state?.projects ?? []
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0]
  const [selectedConversations, setSelectedConversations] = useState<Record<string, string>>({})
  const conversations = (workspace.state?.conversations ?? []).filter(
    (item) => item.projectId === selectedProject?.id,
  )
  const activeConversation =
    conversations.find((item) => item.id === selectedConversations[selectedProject?.id ?? '']) ??
    conversations.at(-1)
  const locked = Boolean(workspace.generatingId) || workspace.pending
  const settings = workspace.state?.settings
  const model = settings?.defaultProvider === 'ollama' ? settings.ollamaModel : settings?.codexModel
  useEffect(() => {
    const title =
      projectForm === 'new'
        ? 'Create a project'
        : projectForm === 'edit'
          ? 'Project context'
          : page === 'workspace'
            ? (selectedProject?.name ?? 'Workspace')
            : page === 'catalog'
              ? 'Catalog'
              : page === 'providers'
                ? 'Providers'
                : 'Projects'
    document.title = `${title} · MWIDE`
  }, [page, projectForm, selectedProject?.name])
  const navigate = async (next: WorkspacePage) => {
    if (page === next && !projectForm) return
    if (!(await workspace.confirmDiscard())) return
    setPage(next)
    setProjectForm(null)
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
      setPage('workspace')
    }
  }
  const openProject = async (id: string) => {
    if (!(await workspace.confirmDiscard())) return
    setPage('workspace')
    setProjectForm(null)
    setSelectedProjectId(id)
    workspace.clearError()
  }
  const createProject = async () => {
    if (!(await workspace.confirmDiscard())) return
    setPage('workspace')
    setSelectedProjectId(null)
    setProjectForm('new')
    workspace.clearError()
  }
  const selectConversation = async (id: string) => {
    if (!selectedProject || !(await workspace.confirmDiscard())) return
    setSelectedConversations((previous) => ({ ...previous, [selectedProject.id]: id }))
    setProjectForm(null)
    setPage('workspace')
    workspace.clearError()
  }
  const newConversation = async () => {
    if (!selectedProject || !(await workspace.confirmDiscard())) return
    setProjectForm(null)
    setPage('workspace')
    const next = await workspace.mutate((bridge) => bridge.createConversation(selectedProject.id))
    const created = next?.conversations.find(
      (item) =>
        item.projectId === selectedProject.id &&
        !conversations.some((previous) => previous.id === item.id),
    )
    if (created) {
      setSelectedConversations((previous) => ({ ...previous, [selectedProject.id]: created.id }))
    }
  }
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="app-shell">
        <WorkspaceSidebar
          page={page}
          projects={projects}
          project={selectedProject}
          conversations={conversations}
          activeConversationId={activeConversation?.id}
          locked={locked}
          creatingProject={projectForm === 'new'}
          provider={
            settings
              ? settings.defaultProvider === 'ollama'
                ? 'Ollama'
                : 'ChatGPT / Codex'
              : 'Not configured'
          }
          model={model}
          onNavigate={(next) => void navigate(next)}
          onProject={(id) => void openProject(id)}
          onConversation={(id) => void selectConversation(id)}
          onNewProject={() => void createProject()}
          onNewConversation={() => void newConversation()}
        />
        <main id="main-content" className="main-panel" tabIndex={-1}>
          <header className="app-topbar">
            <div className="workspace-path">
              <Icon name="terminal" size={16} />
              <span>workspace</span>
              <span className="path-separator">/</span>
              <strong>{page === 'workspace' ? (selectedProject?.name ?? 'home') : page}</strong>
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
          ) : selectedProject && page === 'workspace' ? (
            <ChatWorkspace
              key={selectedProject.id}
              project={selectedProject}
              workspace={workspace}
              onEdit={() => setProjectForm('edit')}
              conversationId={activeConversation?.id}
              onNewConversation={() => void newConversation()}
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
                        onClick={() => void openProject(project.id)}
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
