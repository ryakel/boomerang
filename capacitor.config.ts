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
    contentInset: 'always',
  },
}

export default config
