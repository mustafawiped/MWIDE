import { useEffect, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import type { Conversation, Project } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'
import { EmptyState, Icon, Textarea } from './ui'

export function ChatWorkspace({
  project,
  workspace,
  onBack,
  onEdit,
}: {
  project: Project
  workspace: WorkspaceController
  onBack: () => void
  onEdit: () => void
}): JSX.Element {
  const conversations = (workspace.state?.conversations ?? []).filter(
    (item) => item.projectId === project.id,
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const drafts = workspace.chatDrafts
  const setDrafts = workspace.setChatDrafts
  const active = conversations.find((item) => item.id === selectedId) ?? conversations[0]
  const draft = active ? (drafts[active.id] ?? '') : ''
  const busy = Boolean(workspace.generatingId)
  const streaming = active?.id === workspace.generatingId && !workspace.responseSaved
  const savingMemory = active?.id === workspace.generatingId && workspace.responseSaved
  const streamContainer = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const displayedConversation = useRef<string | undefined>(undefined)
  const composer = useRef<HTMLFormElement>(null)
  const settings = workspace.state?.settings
  const provider = settings?.defaultProvider === 'ollama' ? 'Ollama' : 'ChatGPT / Codex'
  const model = settings?.defaultProvider === 'ollama' ? settings.ollamaModel : settings?.codexModel
  const selectedCatalog = (workspace.state?.catalog ?? []).filter((entry) =>
    project.catalogIds.includes(entry.id),
  )
  useEffect(() => {
    const container = streamContainer.current
    if (!container) return
    if (displayedConversation.current !== active?.id) {
      displayedConversation.current = active?.id
      followLatest.current = true
    }
    if (followLatest.current) container.scrollTop = container.scrollHeight
  }, [active?.id, active?.messages.length, workspace.stream])
  const newChat = async () => {
    const next = await workspace.mutate((bridge) => bridge.createConversation(project.id))
    const created = next?.conversations.find(
      (item) =>
        item.projectId === project.id && !conversations.some((previous) => previous.id === item.id),
    )
    if (created) setSelectedId(created.id)
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!active || !draft.trim() || busy || workspace.pending) return
    const content = draft.trim()
    const conversationId = active.id
    followLatest.current = true
    setDrafts((previous) => ({ ...previous, [conversationId]: '' }))
    const sent = await workspace.send(conversationId, content)
    if (!sent)
      setDrafts((previous) => ({
        ...previous,
        [conversationId]: previous[conversationId] || content,
      }))
    composer.current?.querySelector('textarea')?.focus()
  }
  const renderMessages = (conversation: Conversation) => (
    <>
      {conversation.messages
        .filter((message) => !(streaming && message.id === workspace.activeReplyId))
        .map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="message-avatar" aria-hidden="true">
              {message.role === 'user' ? 'Y' : 'M'}
            </div>
            <div className="message-body">
              <div className="message-meta">
                <strong>{message.role === 'user' ? 'You' : 'MWIDE'}</strong>
                <span>
                  {new Date(message.createdAt).toLocaleTimeString('en', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                {message.status !== 'complete' && <span className="badge">{message.status}</span>}
              </div>
              <div className="message-content">{message.content}</div>
            </div>
          </article>
        ))}
      {streaming && (
        <article className="message assistant">
          <div className="message-avatar" aria-hidden="true">
            M
          </div>
          <div className="message-body">
            <div className="message-meta">
              <strong>MWIDE</strong>
              <span className="stream-indicator">
                {workspace.cancelling ? 'Stopping…' : 'Responding…'}
              </span>
            </div>
            <div className="message-content">{workspace.stream || 'Waiting for the model…'}</div>
          </div>
        </article>
      )}
    </>
  )
  return (
    <div className="project-workspace">
      <header className="chat-topbar">
        <button className="button ghost" disabled={busy || workspace.pending} onClick={onBack}>
          ← Projects
        </button>
        <span className="topbar-divider" />
        <h1>{project.name}</h1>
        <button
          className="button ghost context-edit"
          disabled={busy || workspace.pending}
          onClick={onEdit}
        >
          Edit project context
        </button>
      </header>
      <div className="workspace-layout">
        <aside className="conversations-panel" aria-label="Project conversations">
          <div className="conversation-heading">
            <span className="eyebrow">CONVERSATIONS</span>
            <button
              className="icon-button"
              aria-label="New conversation"
              title="New conversation"
              disabled={busy || workspace.pending}
              onClick={() => void newChat()}
            >
              <Icon name="plus" size={18} />
            </button>
          </div>
          <div className="conversation-list">
            {conversations.length === 0 ? (
              <p className="inline-empty">Your conversations will appear here.</p>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`conversation-item ${active?.id === conversation.id ? 'selected' : ''}`}
                  disabled={busy}
                  aria-current={active?.id === conversation.id ? 'page' : undefined}
                  onClick={() => setSelectedId(conversation.id)}
                  title={conversation.title}
                >
                  <Icon name="chat" size={16} />
                  <span>{conversation.title}</span>
                </button>
              ))
            )}
          </div>
          <div className="project-context-preview">
            <span className="eyebrow">PROJECT CONTEXT</span>
            <p>{project.description}</p>
            <span className="muted small">
              {selectedCatalog.length} selected catalog{' '}
              {selectedCatalog.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </aside>
        <section className="chat-main" aria-label="Conversation">
          <header className="chat-header">
            <div>
              <h2>{active?.title ?? 'Start a conversation'}</h2>
              <span className="model-label">
                {provider}
                <span> / </span>
                {model || 'No model selected'}
              </span>
            </div>
            <span className="memory-badge" role={savingMemory ? 'status' : undefined}>
              <span aria-hidden="true" />
              {savingMemory
                ? workspace.cancelling
                  ? 'Response saved · stopping memory update…'
                  : 'Response saved · updating memory…'
                : active?.summary
                  ? 'Context memory saved'
                  : 'Project context included'}
            </span>
          </header>
          <div
            className="chat-stream"
            ref={streamContainer}
            role="log"
            aria-label="Messages"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={streaming}
            onScroll={(event) => {
              const container = event.currentTarget
              followLatest.current =
                container.scrollHeight - container.scrollTop - container.clientHeight < 100
            }}
          >
            {!active ? (
              <EmptyState icon="chat" title="A new thread for your project.">
                Create a conversation to work with your project brief and selected instructions.
              </EmptyState>
            ) : active.messages.length === 0 && !streaming ? (
              <EmptyState icon="sparkles" title="What would you like to work on?">
                Your project context is included. Bring an idea, a question, or your next step.
              </EmptyState>
            ) : (
              renderMessages(active)
            )}
          </div>
          {active && (
            <details className="context-panel">
              <summary>
                <span>Conversation memory</span>
                <span className="muted small">
                  {active.summary
                    ? `${active.summaryThrough} messages summarized`
                    : 'No summary yet'}
                </span>
              </summary>
              <div className="context-summary">
                <p>
                  {active.summary ||
                    'Optimize this conversation to save a compact summary of earlier messages for future replies.'}
                </p>
                <button
                  className="button secondary"
                  disabled={busy || workspace.pending || active.messages.length === 0}
                  onClick={() =>
                    void workspace.mutate((bridge) => bridge.summarizeConversation(active.id))
                  }
                >
                  <Icon name="sparkles" size={15} />
                  Optimize conversation
                </button>
              </div>
            </details>
          )}
          <form
            ref={composer}
            className="composer"
            noValidate
            onSubmit={(event) => void submit(event)}
          >
            <label className="sr-only" htmlFor="chat-message">
              Message
            </label>
            <Textarea
              id="chat-message"
              className="composer-input resize-none"
              rows={3}
              maxLength={12_000}
              value={draft}
              disabled={!active || busy || workspace.pending}
              placeholder={
                active
                  ? 'Describe what you want to work on…'
                  : 'Create a conversation to get started'
              }
              onChange={(event) => {
                if (active)
                  setDrafts((previous) => ({ ...previous, [active.id]: event.target.value }))
              }}
              onKeyDown={(event) => {
                if (
                  !event.nativeEvent.isComposing &&
                  event.key === 'Enter' &&
                  (event.ctrlKey || event.metaKey)
                ) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <div className="composer-footer">
              <span>
                {active ? 'Ctrl / ⌘ + Enter to send' : 'Each conversation keeps its own history.'}
              </span>
              {busy ? (
                <button
                  className="button secondary"
                  type="button"
                  disabled={workspace.cancelling}
                  onClick={() => void workspace.stop()}
                >
                  <Icon name="stop" size={15} />
                  {workspace.cancelling
                    ? 'Stopping…'
                    : savingMemory
                      ? 'Stop memory update'
                      : 'Stop response'}
                </button>
              ) : active ? (
                <button
                  className="button primary"
                  type="submit"
                  disabled={!draft.trim() || workspace.pending}
                >
                  <Icon name="send" size={16} />
                  Send
                </button>
              ) : (
                <button
                  className="button primary"
                  type="button"
                  disabled={workspace.pending}
                  onClick={() => void newChat()}
                >
                  <Icon name="plus" size={16} />
                  New conversation
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
