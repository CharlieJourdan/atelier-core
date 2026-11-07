import { useState } from 'react'
import { PROVIDER_IDS, type PricePatch, type PriceRow, type ProviderId } from '../../../shared/api'
import { TIERS } from '../../../shared/roles'
import { call, useApi } from '../../state/client'

const PRICE_FIELDS: { key: keyof PricePatch; label: string }[] = [
  { key: 'inputPerMTok', label: 'Input' },
  { key: 'outputPerMTok', label: 'Output' },
  { key: 'cacheReadPerMTok', label: 'Cache read' },
  { key: 'cacheWritePerMTok', label: 'Cache write' }
]

export function ModelsPanel() {
  const defaults = useApi('llm.defaults', ['routes', 'settings'])
  const prices = useApi('prices.list', ['prices'])
  const [error, setError] = useState<string | null>(null)
  const guard = (p: Promise<unknown>): void => {
    setError(null)
    p.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  if (defaults.error || prices.error) return <p className="error">{defaults.error ?? prices.error}</p>
  if (!defaults.data || !prices.data) return <p className="muted">Loading…</p>

  return (
    <div className="stack">
      {error && <p className="error small">{error}</p>}
      <div className="card">
        <div className="card-title">Default provider</div>
        <select
          className="select"
          value={defaults.data.defaultProvider}
          onChange={(e) => guard(call('llm.setDefaultProvider', e.target.value as ProviderId))}
        >
          {PROVIDER_IDS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <table className="table">
        <caption>Model per tier</caption>
        <tbody>
          {TIERS.map((tier) => (
            <tr key={tier}>
              <td>{tier}</td>
              <td>
                <input
                  className="input mono"
                  defaultValue={defaults.data?.tierModels[tier]}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v && v !== defaults.data?.tierModels[tier]) guard(call('llm.setTierModel', tier, v))
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="table">
        <caption>Prices (USD per million tokens)</caption>
        <thead>
          <tr>
            <th>Model</th>
            {PRICE_FIELDS.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {prices.data.map((p) => (
            <PriceLine key={p.model} price={p} onSave={(patch) => guard(call('prices.set', p.model, patch))} />
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Prices marked <span className="badge">placeholder</span> were never set to real rates. Edit them to
        your actual rates; the badge goes away once a value is saved.
      </p>
    </div>
  )
}

function PriceLine({ price, onSave }: { price: PriceRow; onSave: (patch: PricePatch) => void }) {
  return (
    <tr data-testid={`price-${price.model}`}>
      <td className="mono">{price.model}</td>
      {PRICE_FIELDS.map((f) => (
        <td key={f.key}>
          <input
            className="input num"
            type="number"
            min={0}
            step="any"
            defaultValue={price[f.key]}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (e.target.value !== '' && Number.isFinite(v) && v >= 0 && v !== price[f.key]) onSave({ [f.key]: v })
            }}
          />
        </td>
      ))}
      <td>{price.isPlaceholder && <span className="badge">placeholder</span>}</td>
    </tr>
  )
}
