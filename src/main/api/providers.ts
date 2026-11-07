import { PROVIDER_IDS, type ApiHandlers, type ProviderId, type ProviderInfo } from '../../shared/api'
import { secretNameFor } from '../llm'
import type { ApiContext } from './context'

interface ProviderDbRow {
  id: string
  kind: ProviderInfo['kind']
  label: string
  enabled: number
}

export function providersApi(
  ctx: ApiContext
): Pick<ApiHandlers, 'providers.list' | 'providers.setKey' | 'providers.clearKey' | 'providers.test'> {
  return {
    'providers.list': () => {
      const rows = ctx.db
        .prepare('SELECT id, kind, label, enabled FROM providers ORDER BY created_at, id')
        .all() as unknown as ProviderDbRow[]
      return rows.filter((r) => isProviderId(r.id)).map((r) => {
        const secret = secretNameFor(r.id as ProviderId)
        return {
          id: r.id as ProviderId,
          kind: r.kind,
          label: r.label,
          enabled: r.enabled === 1,
          keySet: secret ? ctx.secrets.has(secret) : null
        }
      })
    },
    'providers.setKey': (id, key) => {
      const secret = requireSecretName(id)
      const trimmed = key.trim()
      if (!trimmed) throw new Error('The key is empty')
      ctx.secrets.set(secret, trimmed)
      ctx.notify('providers')
    },
    'providers.clearKey': (id) => {
      ctx.secrets.clear(requireSecretName(id))
      ctx.notify('providers')
    },
    'providers.test': (id) => {
      if (!isProviderId(id)) throw new Error(`Unknown provider: ${String(id)}`)
      return ctx.tester.test(id)
    }
  }
}

function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v)
}

function requireSecretName(id: ProviderId): string {
  const name = isProviderId(id) ? secretNameFor(id) : null
  if (!name) throw new Error(`Provider ${String(id)} does not use a key`)
  return name
}
