// English strings of real mode for Cerveau and Monétisation (keys of fr-p-live-brain.ts).
import type { MessageKey } from './fr'

export const enPLiveBrain: Partial<Record<MessageKey, string>> = {
  /* ---------- labels of what is not real yet ---------- */
  'live.demo.badge': 'Demo data',
  'live.demo.competitors': 'Example: tracking real competitor channels is not connected yet. This map shows what you will see here.',
  'live.demo.niches': 'Example: the niche map (demand and competition) has no real source yet.',
  'live.demo.credits': 'Example: the credit balance is not connected yet, nothing is bought.',

  /* ---------- Brain ---------- */
  'brain.source.manual': 'Typed by hand',
  'brain.idea.add': 'New idea',
  'brain.idea.edit': 'Edit',
  'brain.idea.delete': 'Delete',
  'brain.idea.unscored': 'Not scored by an agent yet',
  'brain.idea.dialog.new': 'New idea',
  'brain.idea.dialog.edit': 'Edit the idea',
  'brain.idea.dialog.hint': 'A video idea: a title and the angle to take. The agents pick it up when you launch it.',
  'brain.idea.field.channel': 'Channel',
  'brain.idea.field.title': 'Title',
  'brain.idea.field.title.ph': 'E.g. The Voynich manuscript',
  'brain.idea.field.angle': 'Angle',
  'brain.idea.field.angle.ph': 'What makes this topic different from the others',
  'brain.idea.save': 'Save',
  'brain.ideas.pick': 'Channel for the ideas you ask for',
  'brain.ideas.noChannel': 'Create a channel first to keep ideas in.',
  'brain.ideas.empty': 'No idea yet. Write one or ask the agent for five.',

  /* ---------- Monetisation ---------- */
  'live.money.loading': 'Loading the figures…',
  'live.money.subtitle': '{n} videos published this month · {scope}',
  'live.money.kpi.revenue': 'Revenue this month',
  'live.money.kpi.cost': 'Costs this month',
  'live.money.kpi.cost.hint': 'measured, typed subscriptions included',
  'live.money.chart.hint': 'Last eight weeks, all channels. Revenue is what you entered.',
  'live.money.chart.allChannels': 'The curve shows all channels, whatever the selection.',
  'live.money.ai': 'AI: calls and subscriptions',
  'live.money.table.others': 'Other revenue',
  'live.money.videos.note': 'Cost = model calls + credits spent on the video. Views are not known: no revenue per video.',
  'live.money.videos.empty': 'No video has cost anything yet this month.',
  'live.money.ledger.title': 'Spend ledger',
  'live.money.ledger.spent': '{usd} spent this month',
  'live.money.ledger.calls': 'Model calls: {n}',
  'live.money.ledger.reserved': '{usd} reserved for calls in progress',
  'live.money.ledger.cap': 'Monthly cap: {usd}',
  'live.money.entries.hint': 'Only revenue is entered here. Costs come from the spend ledger: models, credits, typed subscriptions.',
  'live.money.entries.delete': 'Delete this revenue',
  'live.money.subs.price': 'Price per month in €',
  'live.money.subs.unset': 'Price to fill in',
  'live.money.subs.counted': 'Counted in the costs at the price you type, shared out by published videos.',
  'live.money.subs.empty': 'No AI account configured.',
  'money2.kind.adsense': 'AdSense',
  'money2.kind.affiliate': 'Affiliate'
}
