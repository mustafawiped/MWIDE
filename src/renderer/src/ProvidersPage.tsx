import { useState } from 'react'
import type { JSX } from 'react'
import type { ProviderId, ProviderSettings, ProviderStatus } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'
import { PageHeading } from './ui'
const initialSettings: ProviderSettings = {
  defaultProvider: 'codex',
  codexModel: '',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: '',
}

export function ProvidersPage({ workspace }: { workspace: WorkspaceController }): JSX.Element {
  const [draft, setDraft] = useState<ProviderSettings>(() => ({
    ...(workspace.state?.settings ?? initialSettings),
  }))
  const [statuses, setStatuses] = useState<Partial<Record<ProviderId, ProviderStatus>>>({})
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const disabled = workspace.pending || Boolean(workspace.generatingId)
  const change = (next: Partial<ProviderSettings>) => {
    workspace.markDirty('providers', true)
    setDraft((previous) => ({ ...previous, ...next }))
    setDirty(true)
    setNotice('')
    if ('ollamaUrl' in next) setStatuses((previous) => ({ ...previous, ollama: undefined }))
  }
  const save = async (): Promise<boolean> => {
    if (!draft.ollamaUrl.trim()) return false
    const next = await workspace.mutate((bridge) => bridge.saveSettings(draft))
    if (!next) return false
    setDirty(false)
    workspace.markDirty('providers', false)
    setNotice('Provider settings saved.')
    return true
  }
  const inspect = async (id: ProviderId) => {
    if (dirty && !(await save())) return
    const status = await workspace.execute((bridge) => bridge.inspectProvider(id))
    if (status) setStatuses((previous) => ({ ...previous, [id]: status }))
  }
  const connect = async () => {
    const result = await workspace.execute((bridge) => bridge.signInCodex())
    if (result) setNotice(result.message)
  }
  const modelField = (id: ProviderId) => {
    const value = id === 'codex' ? draft.codexModel : draft.ollamaModel
    const models = [...new Set([...(value ? [value] : []), ...(statuses[id]?.models ?? [])])]
    return (
      <label className="field">
        <span className="field-label">Model</span>
        <select
          className="select"
          value={value}
          onChange={(event) =>
            change(
              id === 'codex'
                ? { codexModel: event.target.value }
                : { ollamaModel: event.target.value },
            )
          }
        >
          <option value="">Select a model</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <span className="hint">Check the connection to discover available models.</span>
      </label>
    )
  }
  return (
    <div className="page-content">
      <PageHeading
        eyebrow="MODELS & CONNECTIONS"
        title="Providers"
        description="Choose where your conversations run."
      />
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      <fieldset disabled={disabled} className="providers-grid">
        <section className="panel provider-card">
          <div className="provider-heading">
            <div className="provider-logo codex-logo" aria-hidden="true">
              C
            </div>
            <div>
              <h2>ChatGPT</h2>
              <p>Through Codex app-server</p>
            </div>
            <span
              className={`connection-dot ${statuses.codex?.connected ? 'connected' : ''}`}
              aria-hidden="true"
            />
          </div>
          <p className="provider-description">
            Connect your ChatGPT account through the official Codex sign-in flow. MWIDE uses its own
            sign-in profile.
          </p>
          <div className="provider-actions">
            <button className="button secondary" onClick={() => void connect()}>
              Connect in browser
            </button>
            <button className="button ghost" onClick={() => void inspect('codex')}>
              Check connection
            </button>
          </div>
          <p
            className={`connection-detail ${statuses.codex?.connected ? 'connected-text' : ''}`}
            role="status"
          >
            {statuses.codex?.detail ?? 'Connection has not been checked.'}
          </p>
          {modelField('codex')}
        </section>
        <section className="panel provider-card">
          <div className="provider-heading">
            <div className="provider-logo ollama-logo" aria-hidden="true">
              O
            </div>
            <div>
              <h2>Ollama</h2>
              <p>Models on your machine</p>
            </div>
            <span
              className={`connection-dot ${statuses.ollama?.connected ? 'connected' : ''}`}
              aria-hidden="true"
            />
          </div>
          <p className="provider-description">
            Use a locally running Ollama service and the models it provides.
          </p>
          <label className="field">
            <span className="field-label">Service URL</span>
            <input
              className="input"
              type="url"
              required
              value={draft.ollamaUrl}
              onChange={(event) => change({ ollamaUrl: event.target.value })}
              placeholder="http://localhost:11434"
            />
          </label>
          <div className="provider-actions">
            <button className="button secondary" onClick={() => void inspect('ollama')}>
              Check connection
            </button>
          </div>
          <p
            className={`connection-detail ${statuses.ollama?.connected ? 'connected-text' : ''}`}
            role="status"
          >
            {statuses.ollama?.detail ?? 'Connection has not been checked.'}
          </p>
          {modelField('ollama')}
        </section>
      </fieldset>
      <section className="panel settings-default">
        <div className="section-heading">
          <h2>Your default provider</h2>
          <p>Used for new messages, recommendations, and conversation summaries.</p>
        </div>
        <fieldset disabled={disabled}>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Provider</span>
              <select
                className="select"
                value={draft.defaultProvider}
                onChange={(event) => change({ defaultProvider: event.target.value as ProviderId })}
              >
                <option value="codex">ChatGPT / Codex</option>
                <option value="ollama">Ollama</option>
              </select>
            </label>
            <div className="field">
              <span className="field-label">Default model</span>
              <div className="default-model">
                {(draft.defaultProvider === 'codex' ? draft.codexModel : draft.ollamaModel) ||
                  'No model selected'}
              </div>
              <span className="hint">Choose a model in its provider card above.</span>
            </div>
          </div>
          <div className="form-actions">
            <span className="hint">
              {dirty ? 'You have unsaved changes.' : 'Provider checks do not run automatically.'}
            </span>
            <button
              className="button primary"
              disabled={!draft.ollamaUrl.trim()}
              onClick={() => void save()}
            >
              {workspace.pending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </fieldset>
      </section>
    </div>
  )
}
