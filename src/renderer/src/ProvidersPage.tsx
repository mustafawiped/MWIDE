import { useState } from 'react'
import type { JSX } from 'react'
import type { ProviderId, ProviderSettings, ProviderStatus } from '../../shared/contracts'
import { parseSettings } from '../../core/validation'
import type { WorkspaceController } from './useWorkspace'
import { PageHeading } from './ui'
import { CompactTabs } from './CompactTabs'
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
  const [urlError, setUrlError] = useState('')
  const [activeTab, setActiveTab] = useState<'codex' | 'ollama' | 'defaults'>('codex')
  const disabled = workspace.pending || Boolean(workspace.generatingId)
  const change = (next: Partial<ProviderSettings>) => {
    workspace.markDirty('providers', true)
    setDraft((previous) => ({ ...previous, ...next }))
    setDirty(true)
    setNotice('')
    if ('ollamaUrl' in next) {
      setUrlError('')
      setStatuses((previous) => ({ ...previous, ollama: undefined }))
    }
  }
  const save = async (): Promise<boolean> => {
    try {
      parseSettings(draft)
    } catch (failure) {
      setUrlError(failure instanceof Error ? failure.message : 'Enter a local Ollama service URL.')
      setActiveTab('ollama')
      requestAnimationFrame(() => document.getElementById('ollama-url')?.focus())
      return false
    }
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
    <div className="page-content providers-page">
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
      <CompactTabs
        id="providers"
        label="Provider settings sections"
        selected={activeTab}
        onSelect={setActiveTab}
        disabled={disabled}
        tabs={[
          { value: 'codex', label: 'ChatGPT' },
          { value: 'ollama', label: 'Ollama', invalid: Boolean(urlError) },
          { value: 'defaults', label: 'Defaults' },
        ]}
      />
      <fieldset disabled={disabled} className="provider-section">
        {activeTab === 'codex' && (
          <section
            className="panel provider-card provider-panel"
            id="providers-panel-codex"
            role="tabpanel"
            aria-labelledby="providers-tab-codex"
          >
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
              Connect your ChatGPT account through the official Codex sign-in flow. MWIDE uses its
              own sign-in profile.
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
        )}
        {activeTab === 'ollama' && (
          <section
            className="panel provider-card provider-panel"
            id="providers-panel-ollama"
            role="tabpanel"
            aria-labelledby="providers-tab-ollama"
          >
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
            <div className="provider-fields">
              <label className="field">
                <span className="field-label">Service URL</span>
                <input
                  className="input"
                  id="ollama-url"
                  type="url"
                  required
                  value={draft.ollamaUrl}
                  onChange={(event) => change({ ollamaUrl: event.target.value })}
                  placeholder="http://localhost:11434"
                  maxLength={2_048}
                  aria-invalid={Boolean(urlError)}
                  aria-describedby={urlError ? 'ollama-url-error' : 'ollama-url-help'}
                />
                {urlError ? (
                  <span id="ollama-url-error" className="field-error">
                    {urlError}
                  </span>
                ) : (
                  <span id="ollama-url-help" className="hint">
                    Local HTTP only, for example http://127.0.0.1:11434.
                  </span>
                )}
              </label>
              {modelField('ollama')}
            </div>
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
          </section>
        )}
        {activeTab === 'defaults' && (
          <section
            className="panel settings-default provider-panel"
            id="providers-panel-defaults"
            role="tabpanel"
            aria-labelledby="providers-tab-defaults"
          >
            <div className="section-heading">
              <h2>Your default provider</h2>
              <p>Used for new messages, recommendations, and conversation summaries.</p>
            </div>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">Provider</span>
                <select
                  className="select"
                  value={draft.defaultProvider}
                  onChange={(event) =>
                    change({ defaultProvider: event.target.value as ProviderId })
                  }
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
                <span className="hint">Choose a model in its provider tab.</span>
              </div>
            </div>
          </section>
        )}
      </fieldset>
      <div className="form-actions provider-save-bar">
        <span className="hint">
          {dirty ? 'You have unsaved changes.' : 'Provider checks do not run automatically.'}
        </span>
        <button className="button primary" disabled={disabled} onClick={() => void save()}>
          Save settings
        </button>
      </div>
    </div>
  )
}
