// Theme registry — the ONE in-app source of truth for theme values and their
// browser-chrome colors. index.html's pre-paint script keeps an inline copy
// (it can't import modules); when adding a theme, update BOTH (two sync
// points, down from three — the old AppV2/SettingsModal maps lived here too).
export const THEME_COLORS = {
  light: '#FFFFFF',
  dark: '#0B0B0F',
  'wallaby-dark': '#0E1322',
  'wallaby-light': '#F4F6FB',
  'kept-dark': '#101713',
  'kept-light': '#F7F4EC',
}

// Apply a theme to the document (data-theme attribute + theme-color meta).
// Returns false for unknown values so callers can fall back.
export function applyTheme(theme) {
  if (!THEME_COLORS[theme]) return false
  document.documentElement.setAttribute('data-theme', theme)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = THEME_COLORS[theme]
  return true
}
