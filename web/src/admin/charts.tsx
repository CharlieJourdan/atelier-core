import { useState } from 'react'
import { cx } from '../ui'

function niceMax(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

/** Line chart in plain SVG: hairline grid, one ink line, a flat low-opacity area, hover read-out. */
export function LineChart({
  data,
  labels,
  format,
  height = 220,
  label
}: {
  data: number[]
  labels: string[]
  format: (v: number) => string
  height?: number
  label: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 560
  const H = height
  const padL = 50
  const padR = 14
  const padT = 14
  const padB = 26
  const max = niceMax(Math.max(...data, 1))
  const x = (i: number): number => padL + (i * (W - padL - padR)) / Math.max(1, data.length - 1)
  const y = (v: number): number => padT + (1 - v / max) * (H - padT - padB)
  const path = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const area = `${path} L${x(data.length - 1).toFixed(1)} ${H - padB} L${x(0).toFixed(1)} ${H - padB} Z`
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const active = hover ?? data.length - 1
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label} : ${labels[active]} ${format(data[active] ?? 0)}`}
        className="block h-auto w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          const i = Math.round(((px - padL) / (W - padL - padR)) * (data.length - 1))
          setHover(Math.min(data.length - 1, Math.max(0, i)))
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke="var(--line)" strokeWidth="1" />
            <text x={padL - 8} y={y(max * t) + 4} textAnchor="end" fontSize="12" fill="var(--fg-3)" className="num">
              {format(max * t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % 2 === (data.length - 1) % 2 ? (
            <text key={l} x={x(i)} y={H - 7} textAnchor="middle" fontSize="12" fill="var(--fg-3)">
              {l}
            </text>
          ) : null
        )}
        <path d={area} fill="var(--ink)" opacity="0.06" />
        <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(active)} x2={x(active)} y1={padT} y2={H - padB} stroke="var(--line-3)" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx={x(active)} cy={y(data[active] ?? 0)} r="4.5" fill="var(--bg)" stroke="var(--ink)" strokeWidth="1.75" />
      </svg>
      <figcaption className="num mt-1 flex items-baseline justify-between text-[12px] text-fg-3">
        <span>{labels[active]}</span>
        <span className="text-[13px] font-medium text-fg">{format(data[active] ?? 0)}</span>
      </figcaption>
    </figure>
  )
}

export const SERIES_COLORS = ['var(--fg)', 'var(--ch-1)', 'var(--ch-3)', 'var(--ch-2)', 'var(--ch-4)', 'var(--ch-5)', 'var(--ch-6)', 'var(--fg-4)']

/** One horizontal stacked bar plus a legend that carries the numbers (never colour alone). */
export function StackedBar({ parts, format }: { parts: { label: string; value: number }[]; format: (v: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}>
        {parts.map((p, i) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: SERIES_COLORS[i % SERIES_COLORS.length] }} className="block h-full min-w-[3px]" />
        ))}
      </div>
      <ul className="m-0 mt-4 grid list-none gap-x-6 gap-y-2 p-0 sm:grid-cols-2">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-fg-2">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="num shrink-0 text-fg">{format(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Horizontal bar with the value written next to it. */
export function HBar({ value, max, tone = 'ink', className }: { value: number; max: number; tone?: 'ink' | 'ok' | 'warn' | 'err'; className?: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100))
  const color = { ink: 'bg-ink', ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err' }[tone]
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="presentation">
      <div className={cx('h-full rounded-full transition-[width] duration-[380ms] ease-out', color)} style={{ width: `${w}%` }} />
    </div>
  )
}
