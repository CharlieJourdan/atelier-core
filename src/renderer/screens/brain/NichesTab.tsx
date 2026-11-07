// « Carte des niches »: filters (language, format, faceless), the scatter, and the list of niches that rise right now.
import { useMemo, useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { SectionHead, Segmented } from '@/components/proto/kit'
import { Label, Switch } from '@/components/ui/input'
import type { Lang, NicheFormat } from '@/proto/data-brain'
import { sparkPath, sparkSeries } from '../home/home-model'
import { risingNiches, visibleNiches, type NicheView } from './brain-model'
import { NicheMap } from './NicheMap'

function RisingList({ views, onPick }: { views: NicheView[]; onPick: (id: string) => void }) {
  const top = risingNiches(views, 5)
  return (
    <section aria-label={t('brain.rising.title')} data-testid="rising-list" className="mt-8">
      <SectionHead title={t('brain.rising.title')} />
      <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line-2 bg-surface-1">
        {top.map((v, i) => (
          <li key={v.niche.id}>
            <button
              type="button"
              onClick={() => onPick(v.niche.id)}
              data-testid="rising-row"
              className="flex w-full items-center gap-4 px-4 py-3 text-left outline-none hover:bg-hover focus-visible:bg-hover"
            >
              <span className="num w-4 shrink-0 text-[12.5px] text-fg-3">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-fg">{t(`brain.niche.${v.niche.id}` as MessageKey)}</span>
                <span className="num block truncate text-[12.5px] text-fg-3">
                  {t('brain.rising.meta', {
                    rpm: v.rpm.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    n: v.channels.toLocaleString('fr-FR')
                  })}
                </span>
              </span>
              <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-[96px] shrink-0" aria-hidden>
                <path
                  d={sparkPath(sparkSeries(v.niche.id, v.growth30))}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className="num w-[52px] shrink-0 text-right text-[13px] font-medium text-ok">+{v.growth30} %</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function NichesTab({ onCreate, onTranslate }: { onCreate: (v: NicheView) => void; onTranslate: (v: NicheView) => void }) {
  const [lang, setLang] = useState<Lang>('fr')
  const [format, setFormat] = useState<NicheFormat>('long')
  const [faceless, setFaceless] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const views = useMemo(() => visibleNiches({ lang, format, facelessOnly: faceless }), [lang, format, faceless])
  const active = selected && views.some((v) => v.niche.id === selected) ? selected : null

  return (
    <div data-testid="niches-tab">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Segmented<Lang>
          size="sm"
          value={lang}
          onChange={setLang}
          options={[
            { value: 'fr', label: t('brain.lang.fr') },
            { value: 'en', label: t('brain.lang.en') },
            { value: 'es', label: t('brain.lang.es') }
          ]}
        />
        <Segmented<NicheFormat>
          size="sm"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'long', label: t('brain.format.long') },
            { value: 'short', label: t('brain.format.short') }
          ]}
        />
        <div className="flex items-center gap-2">
          <Switch id="brain-faceless" checked={faceless} onCheckedChange={setFaceless} data-testid="niches-faceless" aria-label={t('brain.niches.faceless')} />
          <Label htmlFor="brain-faceless" className="text-[13px] font-normal text-fg-2">
            {t('brain.niches.faceless')}
          </Label>
        </div>
        <p className="ml-auto text-[12px] text-fg-3">{t('brain.niches.size')}</p>
      </div>
      <NicheMap views={views} selectedId={active} onSelect={setSelected} onCreate={onCreate} onTranslate={onTranslate} />
      <RisingList views={views} onPick={setSelected} />
    </div>
  )
}
