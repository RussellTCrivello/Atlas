// What every dialog must do for people who cannot use a mouse: put focus inside when it opens, keep Tab from leaving it, close on
// Escape, and give focus back to whatever opened it. Extracted so the record form, the confirmation, the bulk, import and record
// dialogs all behave identically.
import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export const focusableIn = (root: HTMLElement | null): HTMLElement[] =>
  root
    ? ([...root.querySelectorAll(FOCUSABLE)] as HTMLElement[]).filter(
        el => el.offsetParent !== null || el === document.activeElement
      )
    : []

/**
 * Wire a dialog element for keyboard use. `active` is whether it is open; `initialFocus` picks what gets focus first (default:
 * the first control inside); `onEscape` is called for the Escape key. Returns the key handler to put on the dialog element.
 */
export function useDialogKeys(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
  initialFocus?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!active) return
    const opener = document.activeElement as HTMLElement | null
    const timer = setTimeout(() => {
      const target = initialFocus?.current || focusableIn(ref.current)[0] || ref.current
      target?.focus?.()
    }, 0)
    return () => {
      clearTimeout(timer)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
  const latest = useRef(onEscape)
  latest.current = onEscape
  return (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      latest.current()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = focusableIn(ref.current)
    if (!focusable.length) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}
