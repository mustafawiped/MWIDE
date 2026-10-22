import type { JSX, KeyboardEvent } from 'react'

export function CompactTabs<T extends string>({
  id,
  label,
  tabs,
  selected,
  onSelect,
  disabled = false,
}: {
  id: string
  label: string
  tabs: readonly { value: T; label: string; invalid?: boolean }[]
  selected: T
  onSelect: (value: T) => void
  disabled?: boolean
}): JSX.Element {
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    onSelect(tabs[next].value)
    document.getElementById(`${id}-tab-${tabs[next].value}`)?.focus()
  }
  return (
    <div className="management-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          className={selected === tab.value ? 'selected' : ''}
          id={`${id}-tab-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={selected === tab.value}
          aria-controls={`${id}-panel-${tab.value}`}
          tabIndex={selected === tab.value ? 0 : -1}
          disabled={disabled}
          onClick={() => onSelect(tab.value)}
          onKeyDown={(event) => navigate(event, index)}
        >
          {tab.label}
          {tab.invalid && <span className="tab-error-indicator" aria-label="Needs attention" />}
        </button>
      ))}
    </div>
  )
}
