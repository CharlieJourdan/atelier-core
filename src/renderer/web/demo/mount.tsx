import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../../App'
import { CrashBoundary } from '../../components/CrashBoundary'
import { applyTheme, readStoredTheme } from '../../lib/theme'
import '../../styles/app.css'
import { DemoBanner } from './DemoBanner'

applyTheme(readStoredTheme())

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')
createRoot(root).render(
  <StrictMode>
    <div className="flex h-full min-h-0 flex-col">
      <DemoBanner />
      <div className="relative min-h-0 flex-1">
        <CrashBoundary>
          <App />
        </CrashBoundary>
      </div>
    </div>
  </StrictMode>
)
