import { useState } from 'react'
import type { JSX } from 'react'
import type { ProviderId, ProviderStatus } from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'

export function ChatModelControl({
  workspace,
  disabled,
  onConfigureProvider,
}: {
  workspace: WorkspaceController
  disabled: boolean
  onConfigureProvider: () => void
}): JSX.Element {
  const [statuses, setStatuses] = useState<Partial<Record<ProviderId, ProviderStatus>>>({})
  const settings = workspace.state?.settings
  const provider = settings?.defaultProvider ?? 'codex'
  const model = provider === 'codex' ? settings?.codexModel : settings?.ollamaModel
  const status = statuses[provider]
  const models = [...new Set([...(model ? [model] : []), ...(status?.models ?? [])])]
  const update = async (next: {
    defaultProvider?: ProviderId
    codexModel?: string
    ollamaModel?: string
  }) => {
    if (!settings) return
    await workspace.mutate((bridge) => bridge.saveSettings({ ...settings, ...next }))
  }
  const inspect = async () => {
    const result = await workspace.execute((bridge) => bridge.inspectProvider(provider))
    if (result) setStatuses((previous) => ({ ...previous, [provider]: result }))
  }
  return (
    <div className="chat-model-control">
      <select
        className="chat-model-select provider-select"
        aria-label="AI provider"
        title="AI provider"
        value={provider}
        disabled={disabled}
        onChange={(event) => void update({ defaultProvider: event.target.value as ProviderId })}
      >
        <option value="codex">ChatGPT / Codex</option>
        <option value="ollama">Ollama</option>
      </select>
      <select
        className="chat-model-select model-select"
        aria-label="AI model"
        title={model || 'Check AI to discover available models'}
        value={model ?? ''}
        disabled={disabled || models.length === 0}
        onChange={(event) =>
          void update(
            provider === 'codex'
              ? { codexModel: event.target.value }
              : { ollamaModel: event.target.value },
          )
        }
      >
        <option value="">Select a model</option>
        {models.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <button
        className="button ghost chat-provider-check"
        type="button"
        disabled={disabled}
        onClick={() => void inspect()}
        title="Check the connection and discover available models"
      >
        Check AI
      </button>
      <button
        className="button ghost chat-configure-button"
        type="button"
        disabled={disabled}
        onClick={onConfigureProvider}
      >
        Configure AI
      </button>
      {status && (
        <span
          className={`chat-model-status ${status.connected ? 'connected' : ''}`}
          title={status.detail}
          role="status"
        >
          {status.connected ? 'Connected' : 'Connection needed'}
        </span>
      )}
    </div>
  )
}
