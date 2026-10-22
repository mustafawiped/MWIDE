import { useEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { Icon } from './ui'

export function SidebarDrawer({
  children,
  onClose,
}: {
  children: ReactNode
  onClose: () => void
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const trigger =
      document.querySelector<HTMLButtonElement>('.sidebar-toggle') ?? document.activeElement
    const element = dialog.current
    element?.showModal()
    closeButton.current?.focus()
    return () => {
      element?.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
      else document.querySelector<HTMLButtonElement>('.sidebar-toggle')?.focus()
    }
  }, [])
  return (
    <dialog
      className="sidebar-drawer"
      ref={dialog}
      aria-label="Workspace navigation"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <button
        ref={closeButton}
        className="icon-button drawer-close"
        aria-label="Close sidebar"
        onClick={onClose}
      >
        <Icon name="close" size={18} />
      </button>
      {children}
    </dialog>
  )
}
