import { useEffect, useRef, useState } from 'react'
import type { FormEvent, JSX, ReactNode } from 'react'
import type { Conversation, Project } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'
import { ChatModelControl } from './ChatModelControl'
import { MessageContent } from './MessageContent'
import { Icon, Textarea } from './ui'
import symbolBlack from './assets/mwide-symbol-black.svg'

export function ChatWorkspace({
  project,
  workspace,
  conversationId,
  onNewConversation,
  onEdit,
  onConfigureProvider,
  headerStart,
}: {
  project: Project
  workspace: WorkspaceController
  conversationId?: string
  onNewConversation: () => Promise<string | undefined>
  onEdit: () => void
  onConfigureProvider: () => void
  headerStart?: ReactNode
}): JSX.Element {
  const conversations = (workspace.state?.conversations ?? []).filter(
    (item) => item.projectId === project.id,
  )
  const drafts = workspace.chatDrafts
  const setDrafts = workspace.setChatDrafts
  const active = conversations.find((item) => item.id === conversationId) ?? conversations.at(-1)
  const draftKey = active?.id ?? `project:${project.id}`
  const draft = drafts[draftKey] ?? ''
  const [submitting, setSubmitting] = useState(false)
  const [submitNotice, setSubmitNotice] = useState('')
  const submittingRef = useRef(false)
  const busy = Boolean(workspace.generatingId)
  const controlsDisabled = busy || workspace.pending || submitting
  const streaming = active?.id === workspace.generatingId && !workspace.responseSaved
  const savingMemory = active?.id === workspace.generatingId && workspace.responseSaved
  const streamContainer = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const displayedConversation = useRef<string | undefined>(undefined)
  const composer = useRef<HTMLFormElement>(null)
  const settings = workspace.state?.settings
  const model = settings?.defaultProvider === 'ollama' ? settings.ollamaModel : settings?.codexModel
  const selectedCatalog = (workspace.state?.catalog ?? []).filter((entry) =>
    project.catalogIds.includes(entry.id),
  )
  const mcpCount = selectedCatalog.filter((entry) => entry.kind === 'mcp').length
  const skillCount = selectedCatalog.filter((entry) => entry.kind === 'skill').length
  useEffect(() => {
    const container = streamContainer.current
    if (!container) return
    if (displayedConversation.current !== active?.id) {
      displayedConversation.current = active?.id
      followLatest.current = true
    }
    if (followLatest.current) container.scrollTop = container.scrollHeight
  }, [active?.id, active?.messages.length, workspace.stream])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.trim() || controlsDisabled || submittingRef.current) return
    if (!model) {
      setSubmitNotice(
        'Choose an AI model below. Use Check AI to discover models or Configure AI to connect.',
      )
      return
    }
    const content = draft.trim()
    let targetId = active?.id
    submittingRef.current = true
    setSubmitting(true)
    setSubmitNotice('')
    try {
      targetId ??= await onNewConversation()
      if (!targetId) return
      const id = targetId
      followLatest.current = true
      setDrafts((previous) => ({ ...previous, [draftKey]: '', [id]: '' }))
      const sent = await workspace.send(id, content)
      if (!sent) setDrafts((previous) => ({ ...previous, [id]: previous[id] || content }))
    } catch {
      if (targetId) {
        const id = targetId
        setDrafts((previous) => ({ ...previous, [id]: previous[id] || content }))
      }
      setSubmitNotice('Your message was kept. Please try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
      requestAnimationFrame(() => composer.current?.querySelector('textarea')?.focus())
    }
  }
  const renderMessages = (conversation: Conversation) => (
    <>
      {conversation.messages
        .filter((message) => !(streaming && message.id === workspace.activeReplyId))
        .map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="message-avatar" aria-hidden="true">
              {message.role === 'user' ? 'Y' : <img src={symbolBlack} alt="" />}
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
              {message.role === 'assistant' ? (
                <MessageContent content={message.content} />
              ) : (
                <div className="message-content">{message.content}</div>
              )}
            </div>
          </article>
        ))}
      {streaming && (
        <article className="message assistant">
          <div className="message-avatar" aria-hidden="true">
            <img src={symbolBlack} alt="" />
          </div>
          <div className="message-body">
            <div className="message-meta">
              <strong>MWIDE</strong>
              <span className="stream-indicator">
                {workspace.cancelling ? 'Stopping…' : 'Responding…'}
              </span>
            </div>
            <MessageContent content={workspace.stream || 'Waiting for the model…'} />
          </div>
        </article>
      )}
    </>
  )
  return (
    <div className="project-workspace">
      <header className="chat-topbar">
        {headerStart}
        <div className="chat-heading">
          <span className="chat-project-name">{project.name}</span>
          <h1 className="chat-conversation-title">{active?.title ?? 'New conversation'}</h1>
        </div>
        <span className="memory-badge" role={savingMemory ? 'status' : undefined}>
          <span aria-hidden="true" />
          {savingMemory
            ? workspace.cancelling
              ? 'Response saved · stopping memory update…'
              : 'Response saved · updating memory…'
            : active?.summary
              ? 'Memory saved'
              : 'Project context included'}
        </span>
        <button
          className="button ghost context-edit"
          disabled={controlsDisabled}
          onClick={onEdit}
          title="Edit project context"
        >
          <Icon name="projects" size={16} />
          <span>Project context</span>
        </button>
      </header>
      <div className="workspace-layout">
        <section className="chat-main" aria-label="Conversation">
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
            {!active || (active.messages.length === 0 && !streaming) ? (
              <div className="empty-state chat-empty-state">
                <img className="chat-empty-mark" src={symbolBlack} alt="" />
                <span className="chat-empty-kicker">{project.name}</span>
                <h2>What would you like to work on?</h2>
                <p>
                  Ask a question, describe a change, or share an idea. Your project context is
                  included.
                </p>
              </div>
            ) : (
              renderMessages(active)
            )}
            {active && active.messages.length > 0 && (
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
                      'Save a compact summary of earlier messages for future replies.'}
                  </p>
                  <button
                    className="button secondary"
                    disabled={controlsDisabled}
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
          </div>
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
              rows={2}
              maxLength={12_000}
              value={draft}
              disabled={controlsDisabled}
              placeholder="Ask MWIDE anything, or describe what you want to build…"
              aria-describedby="composer-hint"
              onChange={(event) => {
                setDrafts((previous) => ({ ...previous, [draftKey]: event.target.value }))
                if (submitNotice) setSubmitNotice('')
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229 &&
                  (!event.shiftKey || event.ctrlKey || event.metaKey)
                ) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <div className="composer-context">
              <ChatModelControl
                workspace={workspace}
                disabled={controlsDisabled}
                onConfigureProvider={onConfigureProvider}
              />
              <span
                className="composer-catalog"
                title="Selected catalog instructions included with this project"
                aria-label={`${mcpCount} MCP and ${skillCount} skill instructions included`}
              >
                {mcpCount} MCP · {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
              </span>
            </div>
            {(!model || submitNotice) && (
              <p className="composer-notice" role="status">
                {submitNotice ||
                  'Choose a model to start. Check AI to discover models, or Configure AI to connect.'}
              </p>
            )}
            <div className="composer-footer">
              <span className="composer-hint" id="composer-hint">
                Enter to send · Shift + Enter for a new line
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
              ) : (
                <button
                  className="button primary"
                  type="submit"
                  disabled={!draft.trim() || !model || controlsDisabled}
                >
                  <Icon name="send" size={16} />
                  {submitting ? 'Starting…' : 'Send'}
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
