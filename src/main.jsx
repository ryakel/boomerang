import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installApiInterceptor } from './apiConfig.js'
import { initOtaUpdates } from './otaUpdater.js'

// Native (Capacitor) shell only: point relative /api calls at the configured
// server + attach the API token. No-op on the web (nothing configured).
installApiInterceptor()

// Native shell only: swap in the server's newer web bundle (OTA) so web
// changes land without an Xcode rebuild. No-op on the web.
initOtaUpdates()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
