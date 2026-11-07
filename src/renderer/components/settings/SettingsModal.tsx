import { useEffect, useState } from 'react'
import { AgentsPanel } from './AgentsPanel'
import { ModelsPanel } from './ModelsPanel'
import { ProvidersPanel } from './ProvidersPanel'
import { RoutesPanel } from './RoutesPanel'

const TABS = [
  { id: 'providers', label: 'Providers' },
  { id: 'routes', label: 'Routes' },
  { id: 'agents', label: 'Agents' },
  { id: 'models', label: 'Models & prices' }
] as const
type TabId = (typeof TABS)[number]['id']

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('providers')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings-modal">
        <header className="modal-header">
          <h2>Settings</h2>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {tab === 'providers' && <ProvidersPanel />}
          {tab === 'routes' && <RoutesPanel />}
          {tab === 'agents' && <AgentsPanel />}
          {tab === 'models' && <ModelsPanel />}
        </div>
      </div>
    </div>
  )
}
