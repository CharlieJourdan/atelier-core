// Engines and styles per brick (production-3, decision 0021), under « Avancé » in the pipeline editor: for every brick that
// runs on an engine, the engine (empty: the option or the default decides) and its fallbacks in order, which apply to the
// whole video for a voice or a presenter; for every brick that wears a style, the style (empty: the channel's). The engines
// come from Atelier Cloud (`engines.list`); signed out or offline, the reason is shown and the current choices stay.
import { t, type MessageKey } from '../../../../shared/fr'
import type { EngineInfo } from '../../../../shared/cloud-engines'
import type { BrickStyleSummary } from '../../../../shared/brick-styles'
import type { RecipeDocument, TechnologyInfo } from '../../../../shared/recipes'
import { Label, Select } from '@/components/ui/input'
import { useApi } from '@/state/client'
import { techOf } from './recipe-model'

type Brick = RecipeDocument['bricks'][number]

function EngineSelect({ id, value, engines, empty, onChange }: { id: string; value: string | null; engines: EngineInfo[]; empty: string; onChange: (v: string | null) => void }) {
  const known = value === null || engines.some((e) => e.id === value)
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
      <option value="">{empty}</option>
      {!known && value && <option value={value}>{value}</option>}
      {engines.map((e) => (
        <option key={e.id} value={e.id}>
          {e.label} · ≈ {e.priceCredits} cr / {e.unit}
          {e.status === 'draft' ? ` (${t('tech.status.draft').toLowerCase()})` : ''}
        </option>
      ))}
    </Select>
  )
}

export function BrickEngines({ doc, techs, onChange }: { doc: RecipeDocument; techs: readonly TechnologyInfo[]; onChange: (doc: RecipeDocument) => void }) {
  const engines = useApi('engines.list')
  const styles = useApi('brickStyles.list', ['production'])
  const all: EngineInfo[] = engines.data?.engines ?? []
  const styleList: BrickStyleSummary[] = styles.data ?? []
  const patch = (index: number, change: Partial<Brick>): void => onChange({ ...doc, bricks: doc.bricks.map((b, i) => (i === index ? { ...b, ...change } : b)) })
  const rows = doc.bricks.map((b, index) => ({ b, index, tech: techOf(techs, b.tech) })).filter((r) => r.tech && (r.tech.engineFamily || r.tech.styleFamily))
  return (
    <section className="flex flex-col gap-3" data-testid="pipe-engines">
      <h3 className="text-[13px] font-semibold text-fg">{t('pipe.engines')}</h3>
      {engines.data && !engines.data.available && <p className="text-[12px] text-warn">{t('pipe.engines.offline', { reason: engines.data.reason ?? '' })}</p>}
      {rows.map(({ b, index, tech }) => {
        if (!tech) return null
        const family = all.filter((e) => e.family === tech.engineFamily)
        const fallbacks = [...b.fallbacks, null]
        return (
          <div key={b.tech} className="card grid grid-cols-1 gap-3 p-4 md:grid-cols-3" data-testid={`engines-${tech.name}`}>
            <div className="text-[12.5px] font-medium text-fg md:col-span-3">{t(tech.labelKey as MessageKey)}</div>
            {tech.engineFamily && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`eng-${index}`}>{t('pipe.engine')}</Label>
                  <EngineSelect id={`eng-${index}`} value={b.engine} engines={family} empty={t('pipe.engine.default')} onChange={(v) => patch(index, { engine: v })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`fb-${index}-0`}>{t('pipe.fallbacks')}</Label>
                  {fallbacks.map((f, k) => (
                    <EngineSelect
                      key={k}
                      id={`fb-${index}-${k}`}
                      value={f}
                      engines={family}
                      empty="—"
                      onChange={(v) => {
                        const next = [...b.fallbacks]
                        if (v === null) next.splice(k, 1)
                        else next[k] = v
                        patch(index, { fallbacks: next.filter((x, i) => next.indexOf(x) === i) })
                      }}
                    />
                  ))}
                  <span className="text-[11.5px] text-fg-3">{tech.engineFamily === 'voice' || tech.engineFamily === 'presenter' ? t('pipe.fallbacks.video') : t('pipe.fallbacks.item')}</span>
                </div>
              </>
            )}
            {tech.styleFamily && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`sty-${index}`}>{t('pipe.style')}</Label>
                <Select id={`sty-${index}`} value={b.style ?? ''} onChange={(e) => patch(index, { style: e.target.value === '' ? null : e.target.value })}>
                  <option value="">{t('pipe.style.default')}</option>
                  {b.style && !styleList.some((s) => s.id === b.style) && <option value={b.style}>{b.style}</option>}
                  {styleList
                    .filter((s) => s.family === tech.styleFamily)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label ?? s.id} (v{s.version})
                      </option>
                    ))}
                </Select>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
