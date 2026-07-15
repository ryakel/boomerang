import type { CapacitorConfig } from '@capacitor/cli'

// Bundled-assets model: the native shell ships the Vite build (`dist/`) and
// talks to the remote API over the network (Tailscale). It does NOT set
// `server.url`, so the app keeps working offline (the PWA mutation queue +
// cached shell are preserved). The API base URL + token are configured at
// runtime (see src/apiConfig.js), never baked into the bundle.
const config: CapacitorConfig = {
  appId: 'life.boomerang.app', // reverse-DNS bundle id; change to your own before signing
  appName: 'Boomerang',
  webDir: 'dist',
  ios: {
    // Edge-to-edge WebView (the default, 'never'). Do NOT set contentInset:
    // 'always' — the app's CSS already handles notch/home-indicator spacing
    // with env(safe-area-inset-*) + viewport-fit=cover (it ships as an iOS
    // PWA), and a native content inset stacks on top of that: the viewport
    // gets offset and the fixed bottom tab bar lands half off-screen
    // (2026-07-15 fix, first simulator run).
    // Explicitly inspectable (iOS 16.4+ WKWebView isInspectable). Capacitor's
    // "auto-true in development builds" detection proved unreliable on beta
    // toolchains (Safari showed "No Inspectable Applications"), and until the
    // Phase 1.5 in-app Connection screen exists, the Safari Web Inspector is
    // the ONLY way to set boom_api_base/boom_api_token on a device. Single-user
    // personal app — an inspectable WebView in release builds is acceptable.
    webContentsDebuggingEnabled: true,
  },
}

export default config
