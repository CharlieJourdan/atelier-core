// The ingredients of the proposed pipeline (parcours-utilisateur, Charlie 02/11): the price of a minute first with the few choices that
// move it most, then one line per ingredient — pictures, script, voice, presenter, branding, music, motion, editing — with its
// realistic sources (« les miens », « l'agent les trouve », « générés », « clonés »). Calm by default: the chips only; the chosen
// option shows its detail, what the owner brings for it and its effect on price and time.
import { t, type MessageKey } from '../../../../shared/fr'
import type { IngredientOptionView, IngredientView, StudyView } from '../../../../shared/style-agent'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { duration } from './StudyFacts'

const eur = (credits: number, creditEur: number): string => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(credits * creditEur)
const signed = (x: number): string => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x)} %`

function Effect({ o, creditEur }: { o: IngredientOptionView; creditEur: number }) {
  const parts: string[] = []
  if (o.perMinute && o.deltaPct !== null && o.deltaPct !== 0) parts.push(t('ping.price', { before: eur(o.perMinute.before.avg, creditEur), after: eur(o.perMinute.after.avg, creditEur), delta: signed(o.deltaPct) }))
  if (o.renderSeconds && Math.abs(o.renderSeconds.after - o.renderSeconds.before) >= 30) parts.push(t('ping.time', { before: duration(o.renderSeconds.before), after: duration(o.renderSeconds.after) }))
  if (parts.length === 0) parts.push(t('ping.same'))
  return <span className="text-[11.5px] text-fg-3">{parts.join(' · ')}</span>
}

function Row({ ing, s, busy, onChoose }: { ing: IngredientView; s: StudyView; busy: boolean; onChoose: (option: string) => void }) {
  const chosen = ing.options.find((o) => o.id === ing.chosen) ?? ing.options[0]
  return (
    <li className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0" data-testid={`ing-${ing.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-fg">{ing.title}</span>
        {ing.reference && <span className="text-[11.5px] text-fg-3">{ing.reference}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ing.options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy}
            onClick={() => o.id !== ing.chosen && onChoose(o.id)}
            aria-pressed={o.id === ing.chosen}
            data-testid={`ing-option-${o.id}`}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
              o.id === ing.chosen ? 'border-brand-line bg-brand-soft font-medium text-fg' : 'border-line-2 text-fg-2 hover:bg-surface-2',
              o.far && 'opacity-70'
            )}
          >
            <span className="text-[10px] uppercase tracking-[0.05em] text-fg-3">{t(`ping.source.${o.source}` as MessageKey)}</span>
            {o.title}
          </button>
        ))}
      </div>
      {chosen && (
        <div className="flex flex-col gap-0.5 pl-1">
          <span className="text-[12px] leading-[1.45] text-fg-2">{chosen.detail}</span>
          {chosen.needs && <span className="text-[12px] text-fg">{t('ping.needs', { what: chosen.needs })}</span>}
          {chosen.far && <span className="text-[11.5px] text-warn">{t('ping.far')}</span>}
          {chosen.id !== ing.current && <Effect o={chosen} creditEur={s.creditEur} />}
        </div>
      )}
    </li>
  )
}

export function Ingredients({ study, busy, onChoose }: { study: StudyView; busy: boolean; onChoose: (ingredient: string, option: string) => void }) {
  if (study.ingredients.length === 0) return null
  const p = study.price
  return (
    <section className="mb-9 flex flex-col gap-3" data-testid="style-ingredients">
      <h2 className="text-[15px] font-semibold text-fg">{t('ping.title')}</h2>
      {p.perMinute && (
        <div className="card flex flex-col gap-2 p-4" data-testid="style-price">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="num text-[22px] font-semibold tracking-[-0.02em] text-fg">{eur(p.perMinute.avg, study.creditEur)}</span>
            <span className="text-[12.5px] text-fg-2">{t('ping.perMinute', { min: eur(p.perMinute.min, study.creditEur), max: eur(p.perMinute.max, study.creditEur) })}</span>
            <span className="text-[12.5px] text-fg-3">{t('ping.perVideo', { m: String(p.minutes).replace('.', ','), eur: eur(p.perMinute.avg * p.minutes, study.creditEur) })}</span>
          </span>
          {p.levers.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-2" data-testid="style-levers">
              {t('ping.levers')}
              {p.levers.map((l) => (
                <button key={l.option} type="button" disabled={busy} onClick={() => onChoose(l.ingredient, l.option)} className="rounded-full focus-visible:outline-2 focus-visible:outline-ring">
                  <Badge variant={l.deltaPct < 0 ? 'ok' : 'default'}>
                    {l.after ? t('ping.lever', { what: l.title, price: eur(l.after.avg, study.creditEur) }) : `${l.title} ${signed(l.deltaPct)}`}
                  </Badge>
                </button>
              ))}
            </span>
          )}
        </div>
      )}
      <p className="max-w-[760px] text-[12.5px] text-fg-2">{t('ping.lead')}</p>
      <ul className="card flex flex-col px-4 py-1">
        {study.ingredients.map((ing) => (
          <Row key={ing.id} ing={ing} s={study} busy={busy} onChoose={(o) => onChoose(ing.id, o)} />
        ))}
      </ul>
    </section>
  )
}
