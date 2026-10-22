import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceBridge, WorkspaceState } from '../../shared/contracts'

const unavailable =
  'The workspace service is not available in this preview. Your changes have not been saved.'
const message = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.'

export function useWorkspace() {
  const bridge = window.mwide?.workspace
  const [state, setState] = useState<WorkspaceState | null>(null)
  const [loading, setLoading] = useState(Boolean(bridge))
  const [pending, setPending] = useState(false)
  const [operationCancelling, setOperationCancelling] = useState(false)
  const [error, setError] = useState('')
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [stream, setStream] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({})
  const [dirtyForms, setDirtyForms] = useState<Record<string, boolean>>({})
  const mounted = useRef(true)
  const taskPending = useRef(false)
  const activeSend = useRef<{ conversationId: string; cancelled: boolean } | null>(null)

  useEffect(() => {
    mounted.current = true
    let disposed = false
    let unsubscribe: (() => void) | undefined
    if (bridge) {
      try {
        unsubscribe = bridge.onChatEvent((event) => {
          if (disposed) return
          if (event.type === 'state') setState(event.state)
          if (event.type === 'delta' && activeSend.current?.conversationId === event.conversationId)
            setStream((previous) => previous + event.text)
          if (event.type === 'error' && !activeSend.current?.cancelled) setError(event.message)
        })
        void bridge
          .getState()
          .then((next) => {
            if (!disposed) setState(next)
          })
          .catch((failure: unknown) => {
            if (!disposed) setError(message(failure))
          })
          .finally(() => {
            if (!disposed) setLoading(false)
          })
      } catch (failure) {
        queueMicrotask(() => {
          if (!disposed) {
            setError(message(failure))
            setLoading(false)
          }
        })
      }
    }
    return () => {
      disposed = true
      mounted.current = false
      unsubscribe?.()
    }
  }, [bridge])

  const execute = useCallback(
    async <T>(task: (service: WorkspaceBridge) => Promise<T>): Promise<T | undefined> => {
      if (taskPending.current) return undefined
      if (!bridge) {
        setError(unavailable)
        return undefined
      }
      taskPending.current = true
      setPending(true)
      setError('')
      try {
        return await task(bridge)
      } catch (failure) {
        if (mounted.current) setError(message(failure))
        return undefined
      } finally {
        taskPending.current = false
        if (mounted.current) {
          setPending(false)
          setOperationCancelling(false)
        }
      }
    },
    [bridge],
  )

  const mutate = useCallback(
    async (task: (service: WorkspaceBridge) => Promise<WorkspaceState>) => {
      const next = await execute(task)
      if (next && mounted.current) setState(next)
      return next
    },
    [execute],
  )

  const send = useCallback(
    async (conversationId: string, content: string): Promise<boolean> => {
      if (activeSend.current || taskPending.current) return false
      if (!bridge) {
        setError(unavailable)
        return false
      }
      const request = { conversationId, cancelled: false }
      activeSend.current = request
      setGeneratingId(conversationId)
      setStream('')
      setError('')
      try {
        const next = await bridge.sendMessage({ conversationId, content })
        if (mounted.current) setState(next)
        return true
      } catch (failure) {
        if (mounted.current && !request.cancelled) setError(message(failure))
        return false
      } finally {
        if (activeSend.current === request) activeSend.current = null
        if (mounted.current) {
          setGeneratingId(null)
          setStream('')
          setCancelling(false)
        }
      }
    },
    [bridge],
  )

  const stop = useCallback(async () => {
    const request = activeSend.current
    if (!bridge || !request || request.cancelled) return
    request.cancelled = true
    setCancelling(true)
    try {
      await bridge.cancelMessage(request.conversationId)
    } catch (failure) {
      request.cancelled = false
      if (mounted.current) {
        setError(message(failure))
        setCancelling(false)
      }
    }
  }, [bridge])

  const cancelOperation = async () => {
    if (!bridge || !taskPending.current || operationCancelling) return
    setOperationCancelling(true)
    try {
      await bridge.cancelOperation()
    } catch (failure) {
      if (mounted.current) {
        setError(message(failure))
        setOperationCancelling(false)
      }
    }
  }

  const markDirty = (form: string, dirty: boolean) => {
    setDirtyForms((previous) => ({ ...previous, [form]: dirty }))
  }
  const confirmDiscard = (): boolean => {
    if (!Object.values(dirtyForms).some(Boolean)) return true
    if (!window.confirm('You have unsaved changes. Discard them and continue?')) return false
    setDirtyForms({})
    return true
  }

  return {
    state,
    loading,
    pending,
    operationCancelling,
    cancelOperation,
    error,
    generatingId,
    stream,
    cancelling,
    chatDrafts,
    setChatDrafts,
    markDirty,
    confirmDiscard,
    available: Boolean(bridge),
    execute,
    mutate,
    send,
    stop,
    clearError: () => setError(''),
  }
}

export type WorkspaceController = ReturnType<typeof useWorkspace>
