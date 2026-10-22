import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { CodexUsageLimits, ProviderId, UsageLimitWindow } from '../../shared/contracts'
import './chat-controls.css'

function windowLabel(minutes: number | null, fallback: string): string {
  if (minutes === null) return fallback
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

function resetLabel(seconds: number | null): string {
  if (seconds === null) return 'reset time unavailable'
  return `resets ${new Date(seconds * 1_000).toLocaleString('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function UsageWindow({ value, label }: { value: UsageLimitWindow; label: string }): JSX.Element {
  const remaining = Math.round(value.remainingPercent * 10) / 10
  return (
    <span
      className="codex-usage-window"
      title={`${label}: ${remaining}% remaining · ${resetLabel(value.resetsAt)}`}
    >
      <strong>
        {label}: {remaining}% left
      </strong>
      <span>{resetLabel(value.resetsAt)}</span>
    </span>
  )
}

export function CodexUsage({
  provider,
  paused,
  refreshKey,
}: {
  provider: ProviderId
  paused: boolean
  refreshKey: number
}): JSX.Element | null {
  const bridge = window.mwide?.workspace
  const [usage, setUsage] = useState<CodexUsageLimits | null>(null)
  const [failure, setFailure] = useState('')
  const [selectedId, setSelectedId] = useState('codex')
  const inFlight = useRef<Promise<CodexUsageLimits> | null>(null)
  useEffect(() => {
    if (!bridge || provider !== 'codex' || paused) return
    let disposed = false
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      const request = inFlight.current ?? bridge.getCodexUsageLimits()
      inFlight.current = request
      void request
        .then((result) => {
          if (disposed) return
          if (result.available) {
            setUsage(result)
            setFailure('')
          } else {
            setFailure(result.detail || 'Codex account limits are unavailable.')
          }
        })
        .catch((error: unknown) => {
          if (!disposed)
            setFailure(
              error instanceof Error ? error.message : 'Codex account limits are unavailable.',
            )
        })
        .finally(() => {
          if (inFlight.current === request) inFlight.current = null
        })
    }
    refresh()
    const interval = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      disposed = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [bridge, provider, paused, refreshKey])
  if (provider !== 'codex') return null
  const bucket = usage?.buckets.find((item) => item.id === selectedId) ?? usage?.buckets[0]
  const checked = usage
    ? new Date(usage.checkedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <div
      className={`codex-usage ${failure ? 'is-stale' : ''}`}
      aria-label="Codex account usage limits"
    >
      <span className="codex-usage-label" title={usage?.detail}>
        {failure && bucket ? 'Last known Codex limit' : 'Codex limit'}
      </span>
      {usage && usage.buckets.length > 1 && (
        <select
          className="chat-model-select usage-bucket-select"
          aria-label="Codex usage bucket"
          value={bucket?.id ?? ''}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {usage.buckets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      )}
      {bucket?.primary && (
        <UsageWindow
          value={bucket.primary}
          label={windowLabel(bucket.primary.windowDurationMins, 'Primary')}
        />
      )}
      {bucket?.secondary && (
        <UsageWindow
          value={bucket.secondary}
          label={windowLabel(bucket.secondary.windowDurationMins, 'Secondary')}
        />
      )}
      {!bucket && (
        <span className="codex-usage-unavailable" title={failure}>
          {failure
            ? 'Unavailable · check Codex connection'
            : paused
              ? 'Available after the response'
              : 'Checking account…'}
        </span>
      )}
      {bucket && !bucket.primary && !bucket.secondary && (
        <span className="codex-usage-unavailable">No usage windows reported</span>
      )}
      {failure && bucket && (
        <span className="codex-usage-unavailable" title={failure}>
          Refresh unavailable · checked {checked}
        </span>
      )}
      {usage && !failure && (
        <span className="codex-usage-checked" title={`Account limits checked at ${checked}`}>
          Updated {checked}
        </span>
      )}
    </div>
  )
}
