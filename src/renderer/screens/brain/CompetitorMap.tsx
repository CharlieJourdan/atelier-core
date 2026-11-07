// Radial map of the competitors of one channel: our channel at the centre, the others around it. Distance = how close
// their format and audience are to ours, size = subscribers, ring colour = style cluster, an arrow = rising now.
import { ArrowUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { ChannelAvatar, fmtCompact } from '@/components/proto/kit'
import { cn } from '@/lib/utils'
import type { Competitor } from '@/proto/data-brain'
import type { ProtoChannel } from '@/proto/types'
import { layoutMap, ringLevels, ringNorm, styleClusters } from './brain-model'
import { CompetitorCard } from './CompetitorCard'
import { useSize } from './useSize'

const CARD_W = 300
export const MAP_H = 600
const FOOT_H = 46

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()

export function CompetitorMap({
  channel,
  list,
  selectedId,
  onSelect,
  watched,
  onWatch,
  onAsk,
  readOnly = false
}: {
  channel: ProtoChannel
  list: Competitor[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  watched: ReadonlySet<string>
  onWatch: (id: string) => void
  onAsk: (kind: 'style' | 'translate', c: Competitor) => void
  readOnly?: boolean
}) {
  const [ref, size] = useSize<HTMLDivElement>({ w: 760, h: MAP_H - FOOT_H })
  const [hover, setHover] = useState<string | null>(null)
  const clusters = useMemo(() => styleClusters(list), [list])
  const slotOf = (c: Competitor): number => clusters.find((k) => k.style === c.style)?.slot ?? 4
  const placed = useMemo(() => layoutMap(list, size.w, size.h), [list, size.w, size.h])
  const selected = list.find((c) => c.id === selectedId)
  const hovered = hover ? placed.find((p) => p.c.id === hover) : undefined
  const cx = size.w / 2
  const cy = size.h / 2
  const rx = Math.max(80, size.w / 2 - 44)
  const ry = Math.max(80, size.h / 2 - 36)

  return (
    <div
      className="relative overflow-hidden rounded-[16px] border border-line-2 bg-surface-1"
      style={{ height: MAP_H }}
      data-testid="competitor-map"
      data-channel={channel.id}
    >
      <div className="absolute inset-y-0 left-0 flex flex-col" style={{ right: selected ? CARD_W : 0 }}>
        <div ref={ref} className="relative min-h-0 flex-1" onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
          <svg width={size.w} height={size.h} className="pointer-events-none absolute inset-0" aria-hidden>
            {ringLevels().map((s) => (
              <ellipse
                key={s}
                cx={cx}
                cy={cy}
                rx={rx * ringNorm(s)}
                ry={ry * ringNorm(s)}
                fill="none"
                stroke="var(--line-2)"
                strokeWidth={1}
                strokeDasharray="2 5"
              />
            ))}
            {placed.map((p) => {
              const on = p.c.id === selectedId || p.c.id === hover
              return <line key={p.c.id} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={on ? 'var(--fg-3)' : 'var(--line)'} strokeWidth={1} />
            })}
          </svg>

          <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: cx, top: cy }}>
            <ChannelAvatar channel={channel} size={64} className="ring-4 ring-surface-1" />
            <span className="mt-2 max-w-[150px] truncate rounded-[6px] bg-surface-1 px-1.5 text-[12.5px] font-semibold text-fg">{channel.name}</span>
            <span className="num rounded-[6px] bg-surface-1 px-1.5 text-[11.5px] text-fg-3">{t('brain.map.you', { n: fmtCompact(channel.subscribers) })}</span>
          </div>

          {placed.map((p) => {
            const ring = `var(--ch-${slotOf(p.c)})`
            const active = p.c.id === selectedId
            const dim = (selectedId !== null && !active) || (hover !== null && hover !== p.c.id && selectedId === null)
            return (
              <div key={p.c.id} className="absolute" style={{ left: p.x, top: p.y }}>
                <button
                  type="button"
                  data-testid={`competitor-node-${p.c.id}`}
                  data-competitor={p.c.id}
                  data-rising={p.c.rising}
                  aria-label={`${p.c.name}, ${fmtCompact(p.c.subscribers)}`}
                  aria-pressed={active}
                  onClick={() => onSelect(active ? null : p.c.id)}
                  onMouseEnter={() => setHover(p.c.id)}
                  onMouseLeave={() => setHover((h) => (h === p.c.id ? null : h))}
                  onFocus={() => setHover(p.c.id)}
                  onBlur={() => setHover((h) => (h === p.c.id ? null : h))}
                  className={cn(
                    'absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-surface-2 text-fg-2 outline-none transition-[opacity,background-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
                    active ? 'bg-selected text-fg' : 'hover:bg-selected hover:text-fg',
                    dim && 'opacity-60'
                  )}
                  style={{
                    width: p.r * 2,
                    height: p.r * 2,
                    boxShadow: `inset 0 0 0 ${active ? 2.5 : 2}px ${ring}`,
                    fontSize: Math.max(9, p.r * 0.62)
                  }}
                >
                  {p.r >= 14 && (
                    <span aria-hidden className="font-semibold">
                      {initials(p.c.name)}
                    </span>
                  )}
                  {p.c.rising && (
                    <span
                      aria-hidden
                      className="absolute -top-1 -right-1 flex size-[15px] items-center justify-center rounded-full bg-ink text-ink-fg ring-2 ring-surface-1"
                    >
                      <ArrowUp className="size-2.5" strokeWidth={3} />
                    </span>
                  )}
                </button>
                {((p.label !== null && !active) || hover === p.c.id) && (
                  <span
                    className={cn(
                      'pointer-events-none absolute -translate-x-1/2 text-[11.5px] whitespace-nowrap transition-opacity duration-150',
                      active || hover === p.c.id ? 'font-medium text-fg' : 'text-fg-2',
                      dim && 'opacity-60'
                    )}
                    style={(p.label ?? (p.y >= cy ? 'below' : 'above')) === 'below' ? { top: p.r + 5 } : { bottom: p.r + 5 }}
                  >
                    {p.c.name}
                  </span>
                )}
              </div>
            )
          })}

          {hovered && !selected && (
            <div
              data-testid="competitor-tip"
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[10px] border border-line-2 bg-surface-pop px-2.5 py-1.5 shadow-[var(--shadow-pop)]"
              style={{
                left: Math.min(size.w - 100, Math.max(100, hovered.x)),
                top: Math.max(46, hovered.y - hovered.r - 8)
              }}
            >
              <p className="text-[12.5px] font-medium whitespace-nowrap text-fg">{hovered.c.name}</p>
              <p className="num text-[11.5px] whitespace-nowrap text-fg-3">
                {t('brain.map.tip', {
                  subs: fmtCompact(hovered.c.subscribers),
                  sim: Math.round(hovered.c.similarity * 100)
                })}
              </p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-line px-4" style={{ height: FOOT_H }}>
          <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1" aria-label={t('brain.map.legend')} data-testid="competitor-legend">
            {clusters.map((k) => (
              <li key={k.style} className="flex items-center gap-1.5 text-[12px] whitespace-nowrap text-fg-2">
                <span aria-hidden className="size-2.5 rounded-full bg-surface-2" style={{ boxShadow: `inset 0 0 0 2px var(--ch-${k.slot})` }} />
                {t(`brain.style.${k.style}` as MessageKey)}
                <span className="num text-fg-3">{k.count}</span>
              </li>
            ))}
          </ul>
          <p className="flex shrink-0 items-center gap-3 text-[11.5px] text-fg-3">
            <span className="hidden @[900px]:inline">{t('brain.map.legend.distance')}</span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="inline-flex size-3 items-center justify-center rounded-full bg-ink text-ink-fg">
                <ArrowUp className="size-2" strokeWidth={3.2} />
              </span>
              {t('brain.map.legend.rising')}
            </span>
          </p>
        </div>
      </div>

      {selected && (
        <CompetitorCard
          key={selected.id}
          c={selected}
          ringColor={`var(--ch-${slotOf(selected)})`}
          watched={watched.has(selected.id)}
          onWatch={() => onWatch(selected.id)}
          onAsk={(kind) => onAsk(kind, selected)}
          onClose={() => onSelect(null)}
          readOnly={readOnly}
        />
      )}
    </div>
  )
}
