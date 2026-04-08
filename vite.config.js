import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

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
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/api/],
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
    // Prepend push-sw.js to the Workbox-generated SW so push handler is top-level & synchronous
    {
      name: 'prepend-push-sw',
      enforce: 'post',
      closeBundle() {
        const swPath = path.resolve('dist/sw.js')
        const pushPath = path.resolve('public/push-sw.js')
        if (existsSync(swPath) && existsSync(pushPath)) {
          const pushCode = readFileSync(pushPath, 'utf-8')
          const swCode = readFileSync(swPath, 'utf-8')
          writeFileSync(swPath, pushCode + '\n// --- Workbox ---\n' + swCode)
          console.log('[build] Prepended push-sw.js to sw.js')
        }
      },
    },
  ],
})
