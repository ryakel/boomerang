import { createContext } from 'react'

// Where SheetPortal renders: the shell root (.bm-shell / .bm-desktop), set by
// KeptShell and KeptDesktop. Null falls back to document.body.
export const SheetHostContext = createContext(null)
