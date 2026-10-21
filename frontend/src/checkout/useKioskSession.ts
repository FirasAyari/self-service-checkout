import { useEffect, useRef, useState, type Dispatch, type RefObject } from 'react'
import type { Action, State } from './state'

export function useKioskSession(
  state: State,
  dispatch: Dispatch<Action>,
  idleDialogRef: RefObject<HTMLElement | null>,
  clearDialogRef: RefObject<HTMLElement | null>,
  clearDialogOpen: boolean,
  closeClearDialog: () => void,
  clearUndo: () => void,
) {
  const [showIdlePrompt, setShowIdlePrompt] = useState(false)
  const lastActivity = useRef(0)
  const lastFocusedScreen = useRef(state.screen)

  useEffect(() => { lastActivity.current = Date.now() }, [])

  useEffect(() => {
    if (lastFocusedScreen.current === state.screen) return
    lastFocusedScreen.current = state.screen
    document.querySelector<HTMLElement>(state.screen === 'browse' ? '#menu-title' : '#top h1')?.focus()
  }, [state.screen])

  useEffect(() => {
    const markActivity = () => { lastActivity.current = Date.now() }
    window.addEventListener('pointerdown', markActivity, { passive: true })
    window.addEventListener('keydown', markActivity)
    const timer = window.setInterval(() => {
      if (clearDialogOpen || state.screen === 'processing' || state.busy || (state.screen === 'complete' && state.order?.status === 'PENDING_PAYMENT')) return
      if (Date.now() - lastActivity.current > 60_000) setShowIdlePrompt(true)
    }, 1_000)
    return () => {
      window.removeEventListener('pointerdown', markActivity)
      window.removeEventListener('keydown', markActivity)
      window.clearInterval(timer)
    }
  }, [state.screen, state.busy, state.order, clearDialogOpen])

  useEffect(() => {
    if (!showIdlePrompt && !clearDialogOpen) return
    const dialog = showIdlePrompt ? idleDialogRef.current : clearDialogRef.current
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button')
    buttons?.[showIdlePrompt ? 1 : 0]?.focus()
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showIdlePrompt) {
          setShowIdlePrompt(false)
          lastActivity.current = Date.now()
        } else closeClearDialog()
        return
      }
      if (event.key !== 'Tab' || !buttons?.length) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', containFocus)
    const timer = showIdlePrompt ? window.setTimeout(() => {
      setShowIdlePrompt(false)
      clearUndo()
      dispatch({ type: 'idle-reset' })
      lastActivity.current = Date.now()
    }, 15_000) : null
    return () => { if (timer !== null) window.clearTimeout(timer); window.removeEventListener('keydown', containFocus) }
  }, [showIdlePrompt, clearDialogOpen, closeClearDialog, clearUndo, dispatch, idleDialogRef, clearDialogRef])

  function resumeOrder() {
    setShowIdlePrompt(false)
    lastActivity.current = Date.now()
  }

  function startFreshAfterIdle() {
    clearUndo()
    setShowIdlePrompt(false)
    dispatch({ type: 'idle-reset' })
    lastActivity.current = Date.now()
  }

  return { showIdlePrompt, resumeOrder, startFreshAfterIdle }
}
