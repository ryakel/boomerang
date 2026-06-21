import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installApiInterceptor } from './apiConfig.js'

// Native (Capacitor) shell only: point relative /api calls at the configured
// server + attach the API token. No-op on the web (nothing configured).
installApiInterceptor()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
