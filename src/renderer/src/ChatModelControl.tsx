import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  ProviderId,
  ProviderSettings,
  ProviderStatus,
  ReasoningEffort,
} from '../../shared/contracts'
import type { WorkspaceController } from './useWorkspace'

export function ChatModelControl({
  workspace,
  disabled,
  onConfigureProvider,
  onChecked,
}: {
  workspace: WorkspaceController
  disabled: boolean
  onConfigureProvider: () => void
  onChecked: () => void
}): JSX.Element {
  const [statuses, setStatuses] = useState<Partial<Record<ProviderId, ProviderStatus>>>({})
  const [checking, setChecking] = useState(false)
  const [inspectionError, setInspectionError] = useState('')
  const inFlight = useRef<{ target: string; request: Promise<ProviderStatus> } | null>(null)
  const inspectedTarget = useRef('')
  const settings = workspace.state?.settings
  const provider = settings?.defaultProvider ?? 'codex'
  const model = provider === 'codex' ? settings?.codexModel : settings?.ollamaModel
  const status = statuses[provider]
  const models = [...new Set([...(model ? [model] : []), ...(status?.models ?? [])])]
  const capabilities = status?.modelCapabilities?.find((item) => item.model === model)
  const efforts = provider === 'codex' ? (capabilities?.reasoningEfforts ?? []) : []
  const effort = settings?.reasoningEffort
  const unsupportedEffort =
    provider === 'codex' && effort && !efforts.some((item) => item.value === effort)
  const target = `${provider}:${settings?.ollamaUrl ?? ''}`
  const bridge = window.mwide?.workspace
  useEffect(() => {
    if (!bridge || disabled || inspectedTarget.current === target) return
    let disposed = false
    const request =
      inFlight.current?.target === target
        ? inFlight.current.request
        : bridge.inspectProvider(provider)
    inFlight.current = { target, request }
    void request
      .then((result) => {
        if (disposed) return
        inspectedTarget.current = target
        setStatuses((previous) => ({ ...previous, [provider]: result }))
        setInspectionError('')
      })
      .catch((failure: unknown) => {
        if (!disposed)
          setInspectionError(failure instanceof Error ? failure.message : 'AI check failed.')
      })
      .finally(() => {
        if (inFlight.current?.request === request) inFlight.current = null
      })
    return () => {
      disposed = true
    }
  }, [bridge, disabled, provider, target])
  const update = async (next: Partial<ProviderSettings>) => {
    if (!settings) return
    await workspace.mutate((bridge) => bridge.saveSettings({ ...settings, ...next }))
  }
  const inspect = async () => {
    if (!bridge || checking) return
    setChecking(true)
    const request =
      inFlight.current?.target === target
        ? inFlight.current.request
        : bridge.inspectProvider(provider)
    inFlight.current = { target, request }
    try {
      const result = await request
      inspectedTarget.current = target
      setStatuses((previous) => ({ ...previous, [provider]: result }))
      setInspectionError('')
    } catch (failure) {
      setInspectionError(failure instanceof Error ? failure.message : 'AI check failed.')
    } finally {
      if (inFlight.current?.request === request) inFlight.current = null
      setChecking(false)
      onChecked()
    }
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
              ? { codexModel: event.target.value, reasoningEffort: undefined }
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
      <select
        className="chat-model-select effort-select"
        aria-label="Reasoning effort"
        title={
          provider === 'ollama'
            ? 'Reasoning effort is controlled by the Ollama model.'
            : efforts.length === 0
              ? 'This model does not expose reasoning effort choices. Check AI to refresh.'
              : efforts.find((item) => item.value === effort)?.description ||
                'Use the model’s default reasoning effort.'
        }
        value={provider === 'codex' ? (effort ?? '') : ''}
        disabled={disabled || (efforts.length === 0 && !(provider === 'codex' && effort))}
        onChange={(event) =>
          void update({
            reasoningEffort: (event.target.value || undefined) as ReasoningEffort | undefined,
          })
        }
      >
        <option value="">
          {efforts.length > 0 ? 'Effort: model default' : 'Effort: model controlled'}
        </option>
        {unsupportedEffort && <option value={effort}>{effort} (unavailable)</option>}
        {efforts.map((item) => (
          <option key={item.value} value={item.value} title={item.description}>
            Effort: {item.value}
          </option>
        ))}
      </select>
      <button
        className="button ghost chat-provider-check"
        type="button"
        disabled={disabled || checking}
        onClick={() => void inspect()}
        title="Check the connection and discover available models"
      >
        {checking ? 'Checking…' : 'Check AI'}
      </button>
      <button
        className="button ghost chat-configure-button"
        type="button"
        disabled={disabled}
        onClick={onConfigureProvider}
      >
        Configure AI
      </button>
      {(status || inspectionError) && (
        <span
          className={`chat-model-status ${status?.connected && !inspectionError ? 'connected' : ''}`}
          title={inspectionError || status?.detail}
          role="status"
        >
          {inspectionError ? 'Check failed' : status?.connected ? 'Connected' : 'Connection needed'}
        </span>
      )}
    </div>
  )
}
