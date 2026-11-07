import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CrashBoundary } from './components/CrashBoundary'
import { applyTheme, readStoredTheme } from './lib/theme'
import './styles/app.css'

applyTheme(readStoredTheme())

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')
createRoot(root).render(
  <StrictMode>
    <CrashBoundary>
      <App />
    </CrashBoundary>
  </StrictMode>
)
