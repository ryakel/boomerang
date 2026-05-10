import { useEffect, useState } from 'react'

// Returns true when the active v2 theme is one of the terminal sub-variants
// ('terminal-dark' or 'terminal-light'). Subscribes to the documentElement's
// data-theme attribute so the hook re-renders when the user flips themes in
// SettingsModal — no need to thread settings through component trees.
//
// Why a hook + MutationObserver and not a context? Theme changes happen via
// direct DOM mutation (Settings flips data-theme inline, pre-paint script
// flips it before React mounts). A MutationObserver picks up both paths
// without coupling to any specific event bus.
export function useTerminalMode() {
  const [isTerminal, setIsTerminal] = useState(() => {
    if (typeof document === 'undefined') return false
    const theme = document.documentElement.getAttribute('data-theme') || ''
    return theme.startsWith('terminal')
  })

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const update = () => {
      const theme = root.getAttribute('data-theme') || ''
      setIsTerminal(theme.startsWith('terminal'))
    }
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    update()
    return () => observer.disconnect()
  }, [])

  return isTerminal
}
