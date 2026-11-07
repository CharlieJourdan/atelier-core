// IPC handlers, module "orders" (equipe-3-chaines): Charlie's video orders, the same as Atlas's `videos.order` (his message,
// each script under its channel's name). The renderer is untrusted: everything is checked here and in the orders.
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ApiHandlers } from '../../shared/api'
import type { ORDER_METHODS } from '../../shared/api/orders'
import { parseOrder } from '../orchestra/orders/parse'
import { referenceKey } from '../orchestra/orders/app-final'
import type { ApiContext } from './context'

type OrderMethodKey = (typeof ORDER_METHODS)[number]

export function ordersApi(ctx: Pick<ApiContext, 'orchestra' | 'settings' | 'db'>): Pick<ApiHandlers, OrderMethodKey> {
  const orders = () => {
    const o = ctx.orchestra.parts.orders
    if (!o) throw new Error('Les commandes de vidéos ne sont pas disponibles ici.')
    return o
  }
  return {
    'orders.list': (batch) => orders().list(typeof batch === 'string' && batch ? batch.slice(0, 80) : undefined),
    'orders.place': async (input) => {
      if (typeof input !== 'object' || input === null || typeof input.message !== 'string' || !input.message.trim()) throw new Error('Colle tes scripts, chacun sous le nom de sa chaîne.')
      if (input.message.length > 200_000) throw new Error('Message trop long (200 000 caractères au plus).')
      const real = input.real === undefined ? true : input.real === true
      const max = input.maxUsd
      if (max !== undefined && (typeof max !== 'number' || !Number.isFinite(max) || max <= 0 || max > 50)) throw new Error('Plafond invalide (0 à 50 $ par vidéo).')
      if (real && max === undefined) throw new Error('Une vraie commande a besoin d’un plafond par vidéo (maxUsd).')
      const channels = ctx.db.prepare('SELECT id, name FROM channels ORDER BY id').all() as { id: number; name: string }[]
      const parsed = parseOrder(input.message, channels)
      if (parsed.items.length === 0) throw new Error(parsed.problems.join(' ; '))
      return orders().place({ items: parsed.items, real, ...(max !== undefined ? { maxUsdEach: max } : {}) })
    },
    'orders.setReference': (channelId, file) => {
      if (typeof channelId !== 'number' || !Number.isInteger(channelId) || channelId < 1) throw new Error('Chaîne invalide.')
      if (!(ctx.db.prepare('SELECT 1 FROM channels WHERE id = ?').get(channelId))) throw new Error('Chaîne introuvable.')
      if (file === null) {
        ctx.settings.set(referenceKey(channelId), null)
        return { channelId, file: null }
      }
      if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.(mp4|mov|mkv|webm)$/iu.test(file) || !existsSync(file)) throw new Error('Donne le chemin complet d’une vidéo de la chaîne (mp4, mov, mkv, webm) sur cet ordinateur.')
      ctx.settings.set(referenceKey(channelId), file)
      return { channelId, file }
    }
  }
}
