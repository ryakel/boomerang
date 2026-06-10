import { useEffect, useState } from 'react'

// Returns true when the active v2 theme is a Wallaby sub-variant ('wallaby-dark'
// or 'wallaby-light'). Subscribes to documentElement's
// data-theme attribute via MutationObserver so it re-renders on theme flips
// (Settings change + the pre-paint script both mutate the attribute directly).
export function useWallabyMode() {
  const [isWallaby, setIsWallaby] = useState(() => {
    if (typeof document === 'undefined') return false
    return (document.documentElement.getAttribute('data-theme') || '').startsWith('wallaby')
  })

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const update = () => setIsWallaby((root.getAttribute('data-theme') || '').startsWith('wallaby'))
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    update()
    return () => observer.disconnect()
  }, [])

  return isWallaby
}
