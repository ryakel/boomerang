// Theme registry — the ONE in-app source of truth for theme values and their
// browser-chrome colors. index.html's pre-paint script keeps an inline copy
// (it can't import modules); when adding a theme, update BOTH (two sync
// points, down from three — the old AppV2/SettingsModal maps lived here too).
export const THEME_COLORS = {
  light: '#FFFFFF',
  dark: '#0B0B0F',
  'kept-dark': '#16140F',
  'kept-light': '#F8F4ED',
}

// "-system" sentinels (stored verbatim in settings.theme) mean "follow the
// OS color scheme" rather than a fixed choice. They resolve live against
// prefers-color-scheme instead of freezing to whatever the OS happened to
// say at first load.
const SYSTEM_THEMES = {
  system: { dark: 'dark', light: 'light' },
  'kept-system': { dark: 'kept-dark', light: 'kept-light' },
}

function prefersDark() {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
}

// Resolve a stored theme preference to the concrete theme actually painted.
// Concrete themes (e.g. 'kept-dark') pass through unchanged.
export function resolveTheme(theme) {
  const pair = SYSTEM_THEMES[theme]
  if (!pair) return theme
  return prefersDark() ? pair.dark : pair.light
}

export function isSystemTheme(theme) {
  return !!SYSTEM_THEMES[theme]
}

// Apply a theme to the document (data-theme attribute + theme-color meta).
// Returns false for unknown values so callers can fall back.
export function applyTheme(theme) {
  const resolved = resolveTheme(theme)
  if (!THEME_COLORS[resolved]) return false
  document.documentElement.setAttribute('data-theme', resolved)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = THEME_COLORS[resolved]
  return true
}

// Re-applies the theme whenever the OS color scheme flips, for as long as
// the stored preference (read via getTheme(), so it always sees the CURRENT
// value even if the user changes it in Settings) is a "-system" sentinel.
// No-ops for a concrete light/dark preference. Returns an unsubscribe fn.
export function watchSystemTheme(getTheme) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (isSystemTheme(getTheme())) applyTheme(getTheme())
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
