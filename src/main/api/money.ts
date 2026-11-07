// IPC handlers, module "money" (lot Z1). One domain per file.
import type { ApiHandlers } from '../../shared/api'
import type { MONEY_METHODS } from '../../shared/api/money'
import { MoneyStore } from '../money/store'
import { buildOverview, RATE_KEY } from '../money/overview'
import { PACK_SYSTEM, SPONSOR_SYSTEM, packPrompt, parseOfferPack, sponsorPrompt } from '../money/pack'
import type { ApiContext } from './context'

type MoneyMethodKey = (typeof MONEY_METHODS)[number]

export function moneyApi(ctx: ApiContext, now: () => Date = () => new Date()): Pick<ApiHandlers, MoneyMethodKey> {
  const store = new MoneyStore(ctx.db)
  const done = <T>(value: T): T => {
    ctx.notify('money')
    return value
  }
  return {
    'money.overview': () => buildOverview(ctx.db, ctx.settings, now()),
    'money.setRate': (rate) => {
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 5) throw new Error('Taux invalide : un nombre entre 0 et 5 est attendu (exemple : 0,92).')
      ctx.settings.set(RATE_KEY, rate)
      done(undefined)
    },
    'money.revenues.list': (filter) => store.listRevenues(filter ?? {}),
    'money.revenues.save': (input) => done(store.saveRevenue(input)),
    'money.revenues.delete': (id) => {
      store.deleteRevenue(id)
      done(undefined)
    },
    'money.revenues.previewCsv': (text) => store.previewCsv(text),
    'money.revenues.importCsv': (text) => done(store.importCsv(text)),
    'money.sponsors.list': () => store.listSponsors(),
    'money.sponsors.save': (input) => done(store.saveSponsor(input)),
    'money.sponsors.move': (id, stage) => done(store.moveSponsor(id, stage)),
    'money.sponsors.delete': (id) => {
      store.deleteSponsor(id)
      done(undefined)
    },
    'money.sponsors.draft': async (id) => {
      const deal = store.getSponsor(id)
      const answer = await ctx.ask({ role: 'sponsor_writer', system: SPONSOR_SYSTEM, prompt: sponsorPrompt(deal), channelId: deal.channelId, videoId: deal.videoId })
      const message = answer.text.trim()
      if (!message) throw new Error('Le modèle n’a rien répondu. Aucun brouillon enregistré.')
      return done(store.setDraft(id, message))
    },
    'money.offers.list': () => store.listOffers(),
    'money.offers.save': (input) => done(store.saveOffer(input)),
    'money.offers.delete': (id) => {
      store.deleteOffer(id)
      done(undefined)
    },
    'money.offers.pack': async (id) => {
      const offer = store.getOffer(id)
      const answer = await ctx.ask({ role: 'product_builder', system: PACK_SYSTEM, prompt: packPrompt(offer), channelId: offer.channelId })
      return done(store.setPack(id, parseOfferPack(answer.text)))
    }
  }
}
