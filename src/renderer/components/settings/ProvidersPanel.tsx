import { useState } from 'react'
import type { ProviderInfo, ProviderTestResult } from '../../../shared/api'
import { call, useApi } from '../../state/client'

export function ProvidersPanel() {
  const { data, error } = useApi('providers.list', ['providers'])
  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>
  return (
    <div className="stack">
      {data.map((p) => (
        <ProviderCard key={p.id} provider={p} />
      ))}
    </div>
  )
}

function ProviderCard({ provider }: { provider: ProviderInfo }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ProviderTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" data-testid={`provider-${provider.id}`}>
      <div className="card-row">
        <div>
          <div className="card-title">{provider.label}</div>
          <div className="muted small">
            {provider.keySet === null
              ? 'Uses the Claude Code CLI login on this PC (no key).'
              : provider.keySet
                ? 'API key: set'
                : 'API key: not set'}
          </div>
        </div>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void run(async () => setResult(await call('providers.test', provider.id)))}
        >
          Test
        </button>
      </div>
      {provider.keySet !== null && (
        <form
          className="card-row"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await call('providers.setKey', provider.id, key)
              setKey('')
            })
          }}
        >
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={provider.keySet ? 'Replace key…' : 'Paste API key…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" className="button primary" disabled={busy || !key.trim()}>
            Save
          </button>
          {provider.keySet && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void run(() => call('providers.clearKey', provider.id))}
            >
              Remove
            </button>
          )}
        </form>
      )}
      {result && <p className={result.ok ? 'ok small' : 'error small'}>{result.message} ({result.latencyMs} ms)</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
