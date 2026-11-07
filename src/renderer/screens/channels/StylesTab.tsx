// Styles and pipelines of a channel: several pipelines can feed one channel, each with its share of the output.
import { ArrowUpRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { t } from '../../../shared/fr'
import { Select } from '@/components/ui/input'
import type { ProtoChannel, ProtoPipeline } from '@/proto/types'
import { cn } from '@/lib/utils'
import { useProto } from '@/proto/store'
import type { ScreenProps } from '../registry'
import { Inset, Tag } from '../onboarding/parts'
import { EyesPanel } from './EyesPanel'
import { normalize, rebalance } from './extras'

const BAR_TONES = ['bg-ink', 'bg-fg-3', 'bg-line-3', 'bg-surface-3']

/** The id of a real channel of the database (`db-12` → 12); null for a demo channel. */
const realChannelId = (id: string): number | null => (/^db-\d+$/.test(id) ? Number(id.slice(3)) : null)

export function StylesTab({ channel, pipelines, mix, onMix, onRoute }: { channel: ProtoChannel; pipelines: ProtoPipeline[]; mix: Record<string, number>; onMix: (m: Record<string, number>) => void; onRoute: ScreenProps['onRoute'] }) {
  const assigned = Object.keys(mix)
    .map((id) => pipelines.find((p) => p.id === id))
    .filter((p): p is ProtoPipeline => !!p)
  const available = pipelines.filter((p) => !(p.id in mix))
  const [toAdd, setToAdd] = useState('')
  const { mode } = useProto()
  const realId = mode === 'live' ? realChannelId(channel.id) : null
  const add = (): void => {
    const id = toAdd || available[0]?.id
    if (!id) return
    onMix(rebalance({ ...mix, [id]: 0 }, id, assigned.length === 0 ? 100 : 20))
    setToAdd('')
  }
  const remove = (id: string): void => {
    const { [id]: _gone, ...rest } = mix
    onMix(normalize(rest))
  }
  return (
    <div data-testid="styles-tab">
      <p className="mb-5 max-w-[620px] text-[13.5px] leading-[1.55] text-fg-3">{t('chan.styles.hint', { name: channel.name })}</p>
      {assigned.length > 0 && (
        <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={t('chan.styles.mix')} data-testid="styles-mix-bar">
          {assigned.map((p, i) => (
            <span key={p.id} className={cn('transition-[width] duration-200', BAR_TONES[i] ?? 'bg-line-3')} style={{ width: `${mix[p.id] ?? 0}%` }} />
          ))}
        </div>
      )}
      <Inset>
        {assigned.map((p, i) => (
          <div key={p.id} data-testid={`style-row-${p.id}`} className="px-4 py-3.5">
            <div className="flex items-start gap-3">
              <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', BAR_TONES[i] ?? 'bg-line-3')} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-fg">
                  {p.name}
                  <Tag>{t('chan.styles.replicability', { n: p.replicability })}</Tag>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-fg-3">{p.description}</p>
              </div>
              <span className="num w-12 shrink-0 text-right text-[15px] font-medium text-fg" data-testid={`style-share-${p.id}`}>
                {mix[p.id] ?? 0} %
              </span>
              {assigned.length > 1 && (
                <button
                  type="button"
                  aria-label={t('chan.styles.remove', { name: p.name })}
                  onClick={() => remove(p.id)}
                  className="rounded-full p-1.5 text-fg-3 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
            {assigned.length > 1 && (
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={mix[p.id] ?? 0}
                aria-label={t('chan.styles.share', { name: p.name })}
                data-testid={`style-slider-${p.id}`}
                onChange={(e) => onMix(rebalance(mix, p.id, Number(e.target.value)))}
                className="mt-3 ml-[22px] h-1 w-[calc(100%-22px)] cursor-pointer accent-[var(--ink)]"
              />
            )}
          </div>
        ))}
        {assigned.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-fg-3">{t('chan.styles.empty')}</p>}
      </Inset>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Select aria-label={t('chan.styles.add')} data-testid="style-add-select" value={toAdd || available[0]?.id || ''} onChange={(e) => setToAdd(e.target.value)} disabled={available.length === 0} className="h-9 w-[260px] rounded-full">
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <button
          type="button"
          data-testid="style-add"
          disabled={available.length === 0}
          onClick={add}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-3 px-3.5 text-[13px] font-medium text-fg outline-none hover:bg-selected focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden />
          {t('chan.styles.add')}
        </button>
        <button
          type="button"
          data-testid="styles-open-pipelines"
          onClick={() => onRoute({ section: 'production', page: 'pipeline' })}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-fg-2 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t('chan.styles.open')}
          <ArrowUpRight className="size-4" aria-hidden />
        </button>
      </div>
      {realId !== null && <EyesPanel channelId={realId} />}
    </div>
  )
}
