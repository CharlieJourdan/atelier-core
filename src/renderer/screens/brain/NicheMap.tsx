// Scatter of the niches: competition across, demand and growth up, bubble size = estimated RPM. The soft rectangle in the
// top left is the zone where a new channel has the best odds (few channels, strong demand).
import { useMemo, useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { DOMAIN, IDEAL_ZONE, inIdealZone, placeLabels, type NicheView } from './brain-model'
import { NicheCard } from './NicheCard'
import { useSize } from './useSize'

export const NICHE_H = 500
const CARD_W = 310

const PAD = { l: 58, r: 22, t: 22, b: 50 }

export function NicheMap({
  views,
  selectedId,
  onSelect,
  onCreate,
  onTranslate
}: {
  views: NicheView[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onCreate: (v: NicheView) => void
  onTranslate: (v: NicheView) => void
}) {
  const [ref, size] = useSize<HTMLDivElement>({ w: 780, h: NICHE_H })
  const [hover, setHover] = useState<string | null>(null)
  const selected = views.find((v) => v.niche.id === selectedId)
  const plot = useMemo(() => ({ x: PAD.l, y: PAD.t, w: Math.max(120, size.w - PAD.l - PAD.r), h: Math.max(120, size.h - PAD.t - PAD.b) }), [size.w, size.h])
  const px = (x: number): number => plot.x + ((x - DOMAIN.x0) / (DOMAIN.x1 - DOMAIN.x0)) * plot.w
  const py = (y: number): number => plot.y + (1 - (y - DOMAIN.y0) / (DOMAIN.y1 - DOMAIN.y0)) * plot.h

  const bubbles = useMemo(() => {
    const maxRpm = Math.max(1, ...views.map((v) => v.rpm))
    return views.map((v) => ({
      v,
      id: v.niche.id,
      label: t(`brain.niche.${v.niche.id}` as MessageKey),
      x: plot.x + ((v.x - DOMAIN.x0) / (DOMAIN.x1 - DOMAIN.x0)) * plot.w,
      y: plot.y + (1 - (v.y - DOMAIN.y0) / (DOMAIN.y1 - DOMAIN.y0)) * plot.h,
      r: 9 + Math.sqrt(v.rpm / maxRpm) * 19,
      prio: (inIdealZone(v) ? 2 : 0) + (v.niche.id === selectedId ? 4 : 0)
    }))
  }, [views, plot, selectedId])
  const labels = useMemo(() => new Map(placeLabels(bubbles, plot).map((l) => [l.id, l])), [bubbles, plot])
  const hovered = bubbles.find((b) => b.id === hover)
  const zone = { x: plot.x, y: plot.y, w: px(IDEAL_ZONE.xMax) - plot.x, h: py(IDEAL_ZONE.yMin) - plot.y }

  return (
    <div className="relative overflow-hidden rounded-[16px] border border-line-2 bg-surface-1" style={{ height: NICHE_H }} data-testid="niche-map">
      <div ref={ref} className="absolute inset-y-0 left-0" style={{ right: selected ? CARD_W : 0 }}>
        <svg
          width={size.w}
          height={size.h}
          className="absolute inset-0"
          role="group"
          aria-label={t('brain.niches.title')}
          onClick={(e) => e.target === e.currentTarget && onSelect(null)}
        >
          {[30, 50, 70, 90].map((g) => (
            <line key={`x${g}`} aria-hidden x1={px(g)} x2={px(g)} y1={plot.y} y2={plot.y + plot.h} stroke="var(--line)" />
          ))}
          {[50, 70, 90].map((g) => (
            <line key={`y${g}`} aria-hidden x1={plot.x} x2={plot.x + plot.w} y1={py(g)} y2={py(g)} stroke="var(--line)" />
          ))}
          <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill="none" stroke="var(--line-2)" rx={4} aria-hidden />

          <g aria-hidden data-testid="ideal-zone" pointerEvents="none">
            <rect
              x={zone.x}
              y={zone.y}
              width={zone.w}
              height={zone.h}
              rx={10}
              fill="var(--ink)"
              fillOpacity={0.05}
              stroke="var(--line-3)"
              strokeDasharray="4 5"
            />
            <text x={zone.x + 12} y={zone.y + 21} fontSize={12} fontWeight={600} fill="var(--fg)">
              {t('brain.niches.zone')}
            </text>
            <text x={zone.x + 12} y={zone.y + 37} fontSize={11} fill="var(--fg-3)">
              {t('brain.niches.zone.hint')}
            </text>
          </g>

          <g aria-hidden fontSize={11.5} fill="var(--fg-3)">
            <text x={plot.x} y={plot.y + plot.h + 18}>
              {t('brain.niches.x.low')}
            </text>
            <text x={plot.x + plot.w} y={plot.y + plot.h + 18} textAnchor="end">
              {t('brain.niches.x.high')}
            </text>
            <text x={plot.x + plot.w / 2} y={plot.y + plot.h + 36} textAnchor="middle" fontWeight={500} fill="var(--fg-2)">
              {t('brain.niches.x')}
            </text>
            <text x={plot.x - 10} y={plot.y + 10} textAnchor="end">
              {t('brain.niches.y.high')}
            </text>
            <text x={plot.x - 10} y={plot.y + plot.h} textAnchor="end">
              {t('brain.niches.y.low')}
            </text>
            <text transform={`translate(${plot.x - 38} ${plot.y + plot.h / 2}) rotate(-90)`} textAnchor="middle" fontWeight={500} fill="var(--fg-2)">
              {t('brain.niches.y')}
            </text>
          </g>

          {bubbles.map((b) => {
            const on = b.id === selectedId
            const good = inIdealZone(b.v)
            const lab = labels.get(b.id)
            const dim = selectedId !== null && !on
            return (
              <g
                key={b.id}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`${b.label}, RPM ${b.v.rpm}`}
                data-testid="niche-bubble"
                data-niche={b.id}
                data-ideal={good}
                className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-[var(--ring)]"
                                onClick={() => onSelect(on ? null : b.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(on ? null : b.id))}
                onMouseEnter={() => setHover(b.id)}
                onMouseLeave={() => setHover((h) => (h === b.id ? null : h))}
              >
                <circle
                  data-testid={`niche-circle-${b.id}`}
                  cx={b.x}
                  cy={b.y}
                  r={b.r}
                  fill={on ? 'var(--ink)' : 'var(--fg)'}
                  opacity={dim ? 0.5 : 1}
                  fillOpacity={on ? 1 : hover === b.id ? 0.2 : good ? 0.16 : 0.09}
                  stroke={on ? 'var(--ink)' : good ? 'var(--fg)' : 'var(--fg-3)'}
                  strokeWidth={on ? 2 : good ? 1.6 : 1.2}
                />
                {lab && (
                  <text
                    x={lab.x}
                    y={lab.y}
                    textAnchor={lab.anchor}
                    fontSize={12}
                    fontWeight={on || good ? 600 : 500}
                    fill={on || good ? 'var(--fg)' : 'var(--fg-2)'}
                    className="pointer-events-none select-none"
                  >
                    {b.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {hovered && !selected && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[10px] border border-line-2 bg-surface-pop px-2.5 py-1.5 shadow-[var(--shadow-pop)]"
            style={{ left: Math.min(size.w - 90, Math.max(90, hovered.x)), top: Math.max(50, hovered.y - hovered.r - 24) }}
          >
            <p className="text-[12.5px] font-medium whitespace-nowrap text-fg">{hovered.label}</p>
            <p className="num text-[11.5px] whitespace-nowrap text-fg-3">
              {t('brain.niches.tip', {
                rpm: hovered.v.rpm.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                growth: hovered.v.growth30
              })}
            </p>
          </div>
        )}
        {views.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="max-w-[34ch] text-center text-[13px] text-fg-3">{t('brain.niches.empty')}</p>
          </div>
        )}
      </div>

      {selected && (
        <NicheCard
          key={selected.niche.id}
          v={selected}
          ideal={inIdealZone(selected)}
          onClose={() => onSelect(null)}
          onCreate={() => onCreate(selected)}
          onTranslate={() => onTranslate(selected)}
        />
      )}
    </div>
  )
}
