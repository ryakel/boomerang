import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'

let appVersion
try {
  appVersion = execSync('git describe --tags --always').toString().trim()
} catch {
  appVersion = process.env.APP_VERSION || 'dev'
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT || 3001}`,
        // SSE requires no response buffering
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            if (req.url === '/api/events') {
              proxyRes.headers['cache-control'] = 'no-cache'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
      },
      manifest: {
        name: 'Boomerang',
        short_name: 'Boomerang',
        description: 'Tasks that always come back',
        theme_color: '#0B0B0F',
        background_color: '#0B0B0F',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
