// Admin plateforme (lot Z1), owner only: the local price grid with its margins and the credits granted so far.
// Read-only: the real prices, wallets and support queue live in Atelier Cloud (hand-off lot P5: read them from
// CLOUD_ADMIN_ROUTES with a platform-admin token and show them here instead of the local grid).
import type { AdminOverview } from '../../shared/api/team'
import type { CreditsPort } from '../credits/port'
import { creditsPerUnit, LOCAL_PRICE_GRID } from '../credits/prices'
import type { MembersStore } from './members'

export function adminOverview(members: MembersStore, credits: CreditsPort): AdminOverview {
  if (members.self().role !== 'owner') throw new Error('Cette page est réservée au propriétaire de l’équipe.')
  const granted = { local: 0, simulated: 0, example: 0 }
  for (const row of members.grantedBySource()) {
    if (row.source === 'simulated_purchase') granted.simulated += row.total
    else if (row.source === 'example') granted.example += row.total
    else granted.local += row.total
  }
  const g = LOCAL_PRICE_GRID
  return {
    prices: {
      version: g.version,
      creditValueEur: g.creditValueEur,
      overheadPct: g.overheadPct,
      lines: g.items.map((i) => ({ unit: i.unit, providerCostUsd: i.providerCostUsd, marginPct: i.marginPct, creditsPerUnit: creditsPerUnit(i.unit) }))
    },
    granted,
    balance: credits.balance()
  }
}
