import type { JSX } from 'react'
import type { Conversation, Project } from '../../shared/contracts'
import { Brand, Icon } from './ui'
import type { IconName } from './ui'

export type WorkspacePage = 'workspace' | 'projects' | 'catalog' | 'providers'

function closeDisclosure(button: HTMLButtonElement): void {
  const disclosure = button.closest('details')
  disclosure?.removeAttribute('open')
  disclosure?.querySelector('summary')?.focus()
}

export function WorkspaceSidebar({
  page,
  projects,
  project,
  conversations,
  activeConversationId,
  locked,
  creatingProject,
  provider,
  model,
  onNavigate,
  onProject,
  onConversation,
  onNewProject,
  onNewConversation,
}: {
  page: WorkspacePage
  projects: Project[]
  project?: Project
  conversations: Conversation[]
  activeConversationId?: string
  locked: boolean
  creatingProject: boolean
  provider: string
  model?: string
  onNavigate: (page: WorkspacePage) => void
  onProject: (id: string) => void
  onConversation: (id: string) => void
  onNewProject: () => void
  onNewConversation: () => void
}): JSX.Element {
  const nav: { id: WorkspacePage; label: string; icon: IconName; caption: string }[] = [
    { id: 'projects', label: 'Projects', icon: 'projects', caption: 'Your work, in context' },
    { id: 'catalog', label: 'Catalog', icon: 'catalog', caption: 'MCPs & Skills' },
    { id: 'providers', label: 'Providers', icon: 'providers', caption: 'Models & connections' },
  ]
  return (
    <aside className="sidebar" aria-label="Workspace and chat history">
      <Brand />
      <details className="workspace-menu">
        <summary>
          <Icon name="catalog" size={17} />
          <span>Workspace</span>
          <Icon name="chevronDown" size={15} />
        </summary>
        <nav aria-label="Workspace tools">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'nav-active' : ''}`}
              aria-current={page === item.id ? 'page' : undefined}
              disabled={locked}
              onClick={(event) => {
                onNavigate(item.id)
                closeDisclosure(event.currentTarget)
              }}
            >
              <Icon name={item.icon} size={17} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.caption}</small>
              </span>
            </button>
          ))}
        </nav>
      </details>
      <details className="project-switcher">
        <summary title={project?.name}>
          <Icon name="projects" size={17} />
          <span>
            <small>PROJECT</small>
            <strong>{project?.name ?? 'Choose a project'}</strong>
          </span>
          <Icon name="chevronDown" size={15} />
        </summary>
        <div className="project-switcher-list">
          {projects.map((item) => (
            <button
              className={`sidebar-project ${project?.id === item.id ? 'selected' : ''}`}
              key={item.id}
              disabled={locked}
              aria-current={page === 'workspace' && project?.id === item.id ? 'page' : undefined}
              title={item.name}
              onClick={(event) => {
                onProject(item.id)
                closeDisclosure(event.currentTarget)
              }}
            >
              <Icon name="projects" size={15} />
              <span>{item.name}</span>
            </button>
          ))}
          <button
            className="button sidebar-create"
            disabled={locked || creatingProject}
            onClick={(event) => {
              onNewProject()
              closeDisclosure(event.currentTarget)
            }}
          >
            <Icon name="plus" size={16} />
            <span>New project</span>
          </button>
        </div>
      </details>
      <button
        className="button primary sidebar-new-chat"
        aria-label="New conversation"
        disabled={locked || !project}
        onClick={onNewConversation}
      >
        <Icon name="plus" size={17} />
        New conversation
      </button>
      <section className="sidebar-history" aria-label="Project conversations">
        <div className="sidebar-section-heading">
          <h2 className="nav-label">CHAT HISTORY</h2>
          <span className="utility-count">{conversations.length}</span>
        </div>
        {conversations.length ? (
          <div className="conversation-list">
            {[...conversations].reverse().map((conversation) => (
              <button
                key={conversation.id}
                className={`conversation-item ${page === 'workspace' && activeConversationId === conversation.id ? 'selected' : ''}`}
                disabled={locked}
                aria-current={
                  page === 'workspace' && activeConversationId === conversation.id
                    ? 'page'
                    : undefined
                }
                title={conversation.title}
                onClick={() => onConversation(conversation.id)}
              >
                <Icon name="chat" size={16} />
                <span>{conversation.title}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="sidebar-empty">
            {project
              ? 'Start a conversation. Find it here whenever you need it.'
              : 'Choose a project to see its conversations.'}
          </p>
        )}
      </section>
      <div className="sidebar-footer">
        <button
          className="model-switcher"
          disabled={locked}
          onClick={() => onNavigate('providers')}
          aria-label="Configure the default model"
        >
          <span className="model-switcher-icon">
            <Icon name="terminal" size={17} />
          </span>
          <span>
            <strong>{provider}</strong>
            <small>{model || 'Choose a model'}</small>
          </span>
          <Icon name="arrow" size={14} />
        </button>
        <span className="sidebar-wordmark">Easy MCP and Skill Management</span>
      </div>
    </aside>
  )
}
