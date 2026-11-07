// « Atelier peut-il faire ce style ? » (essais-utilisateur, Charlie 03/11): said first, before any proposal — the verdict and the share
// Atelier reproduces, the style's parts (made, approached, not made), what the eyes could not read, the people the pipeline needs
// and how it takes their work, the technologies Atelier lacks (import / build / train, with their cost) and, when the style is out
// of reach, what Atelier does instead with the price of a minute.
import { t, type MessageKey } from '../../../../shared/fr'
import type { StudyView } from '../../../../shared/style-agent'
import type { FeasibilityVerdictId } from '../../../../shared/style-feasibility'
import { SectionHead } from '@/components/proto/kit'
import { Badge } from '@/components/ui/badge'

const eur = (credits: number, creditEur: number): string => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(credits * creditEur)
const VARIANT: Record<FeasibilityVerdictId, 'ok' | 'warn' | 'default'> = { yes: 'ok', partial: 'warn', no: 'default' }

export function Feasibility({ study }: { study: StudyView }) {
  const f = study.feasibility
  if (!f) return null
  return (
    <section className="mb-9 flex flex-col gap-3" data-testid="style-feasibility">
      <SectionHead title={t('pfeas.title')} />
      <article className="card flex max-w-[860px] flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={VARIANT[f.verdict]} data-testid="style-feasibility-verdict">
            {t(`pfeas.verdict.${f.verdict}` as MessageKey)}
          </Badge>
          <span className="num text-[13px] font-semibold text-fg">{t('pfeas.share', { n: f.share })}</span>
        </div>
        <p className="text-[13.5px] leading-[1.55] text-fg">{f.why}</p>
        {f.unread && <p className="text-[12.5px] text-warn">{f.unread}.</p>}
        <ul className="flex flex-col gap-1.5" data-testid="style-feasibility-parts">
          {f.parts.map((p) => (
            <li key={p.title} className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
              <Badge variant={VARIANT[p.can]}>{t(`pfeas.can.${p.can}` as MessageKey)}</Badge>
              <span className="font-medium text-fg">{p.title}</span>
              <span className="num text-fg-3">{p.share} %</span>
              {p.how && <span className="text-fg-2">— {p.how}</span>}
            </li>
          ))}
        </ul>
        {f.instead.length > 0 && f.verdict !== 'yes' && (
          <div className="flex flex-col gap-1.5" data-testid="style-feasibility-instead">
            <span className="text-[13px] font-semibold text-fg">{t('pfeas.instead')}</span>
            {f.instead.map((x) => (
              <p key={x.id} className="text-[12.5px] text-fg-2">
                <span className="font-medium text-fg">{x.title}</span> — {x.detail}
                {x.perMinute && <span className="ml-1 text-fg-3">{t('pfeas.perMinute', { eur: eur(x.perMinute.avg, study.creditEur) })}</span>}
              </p>
            ))}
          </div>
        )}
        {f.humans.length > 0 && (
          <div className="flex flex-col gap-1.5" data-testid="style-feasibility-humans">
            <span className="text-[13px] font-semibold text-fg">{t('pfeas.humans')}</span>
            {f.humans.map((h) => (
              <p key={h.id} className="text-[12.5px] text-fg-2">
                <span className="font-medium text-fg">{h.title}</span> — {h.how}
              </p>
            ))}
          </div>
        )}
        {f.missing.length > 0 && (
          <div className="flex flex-col gap-1.5" data-testid="style-feasibility-missing">
            <span className="text-[13px] font-semibold text-fg">{t('pfeas.missing')}</span>
            {f.missing.map((m) => (
              <p key={m.id} className="text-[12.5px] text-fg-2">
                <Badge variant="default" className="mr-1.5">{t(`pfeas.kind.${m.kind}` as MessageKey)}</Badge>
                <span className="font-medium text-fg">{m.title}</span> — {m.cost}
                {m.slot && <span className="ml-1 text-fg-3">{t('pfeas.slot')}</span>}
              </p>
            ))}
          </div>
        )}
      </article>
    </section>
  )
}
