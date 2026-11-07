import { useState } from 'react'
import { EFFORTS, PROVIDER_IDS, type Effort, type ProviderId, type RoutePatch } from '../../../shared/api'
import { ROLE_GROUPS, TIERS, type RoleGroup } from '../../../shared/roles'
import { call, useApi } from '../../state/client'

const GROUP_LABEL: Record<RoleGroup, string> = {
  steering: 'Steering and strategy',
  production: 'Production',
  operations: 'Distribution and operations'
}

export function RoutesPanel() {
  const routes = useApi('routes.list', ['routes'])
  const defaults = useApi('llm.defaults', ['routes', 'settings'])
  const [error, setError] = useState<string | null>(null)

  const update = (role: string, patch: RoutePatch): void => {
    setError(null)
    call('routes.set', role, patch).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  if (routes.error) return <p className="error">{routes.error}</p>
  if (!routes.data || !defaults.data) return <p className="muted">Loading…</p>
  const { tierModels, defaultProvider } = defaults.data
  const rows = routes.data

  return (
    <div className="stack">
      <p className="muted small">
        Each role uses its tier&apos;s model on the default provider ({defaultProvider}) unless overridden here.
      </p>
      {error && <p className="error small">{error}</p>}
      {ROLE_GROUPS.map((group) => (
        <table key={group} className="table">
          <caption>{GROUP_LABEL[group]}</caption>
          <thead>
            <tr>
              <th>Role</th>
              <th>Tier</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Effort</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.group === group)
              .map((r) => (
                <tr key={r.role} data-testid={`route-${r.role}`}>
                  <td className="mono">{r.role}</td>
                  <td>
                    <select
                      className="select"
                      value={r.tier}
                      onChange={(e) => update(r.role, { tier: e.target.value as RoutePatch['tier'] })}
                    >
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="select"
                      value={r.providerId ?? ''}
                      onChange={(e) => update(r.role, { providerId: (e.target.value || null) as ProviderId | null })}
                    >
                      <option value="">default</option>
                      {PROVIDER_IDS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input mono"
                      defaultValue={r.model ?? ''}
                      placeholder={tierModels[r.tier]}
                      onBlur={(e) => {
                        const next = e.target.value.trim() || null
                        if (next !== r.model) update(r.role, { model: next })
                      }}
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      value={r.effort ?? ''}
                      onChange={(e) => update(r.role, { effort: (e.target.value || null) as Effort | null })}
                    >
                      <option value="">model default</option>
                      {EFFORTS.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}
