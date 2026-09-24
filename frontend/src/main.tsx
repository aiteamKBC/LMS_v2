import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
import './index.css'
import './learner-theme.css'
import App from './App.tsx'
import { installAuditRequestContext } from './lib/auditRequestContext'

installAuditRequestContext()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
