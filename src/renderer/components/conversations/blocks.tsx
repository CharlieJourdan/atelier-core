// Rich blocks of a chat message (PLAN-V2 §7.3): stats, chart, ideas, concepts, beats, keywords, tags, sources, trend,
// steps. Pure presentation of validated data (shared/chat-rich.ts); charts are small hand-drawn SVGs (no library).
import { Check, Circle, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '../../../shared/fr'
import type { BlockDataMap, BlockName, BodySegment } from '../../../shared/chat-rich'
import { cn } from '@/lib/utils'

function BlockFrame({ name, title, children }: { name: BlockName; title?: string; children: ReactNode }) {
  return (
    <section data-testid={`block-${name}`} className="w-full rounded-card border border-line bg-surface-1 p-3 text-fg">
      <h4 className="micro-label mb-2">{title ?? t(`block.${name}`)}</h4>
      {children}
    </section>
  )
}

const fmt = (n: number): string => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n)
const trendTone = (delta: string): string => (delta.startsWith('-') ? 'text-err' : 'text-ok')

function Stats({ data }: { data: BlockDataMap['stats'] }) {
  return (
    <BlockFrame name="stats">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
        {data.items.map((s) => (
          <div key={s.label} className="rounded-field bg-surface-2 px-3 py-2">
            <div className="text-[11px] text-fg-3">{s.label}</div>
            <div className="font-mono text-[17px]">{s.value}</div>
            {s.delta && <div className={cn('font-mono text-[11px]', trendTone(s.delta))}>{s.delta}</div>}
          </div>
        ))}
      </div>
    </BlockFrame>
  )
}

function Chart({ data }: { data: BlockDataMap['chart'] }) {
  const W = 320
  const H = 120
  const pad = 14
  const n = data.series.length
  const max = Math.max(...data.series.map((s) => s.value), 0)
  const min = Math.min(...data.series.map((s) => s.value), 0)
  const span = max - min || 1
  const y = (v: number): number => H - pad - ((v - min) / span) * (H - 2 * pad)
  const slot = (i: number): number => pad + ((i + 0.5) * (W - 2 * pad)) / n
  const base = y(0)
  return (
    <BlockFrame name="chart" {...(data.title ? { title: data.title } : {})}>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full max-w-[420px]" role="img" aria-label={data.title ?? t('block.chart')}>
        <line x1={pad} x2={W - pad} y1={base} y2={base} className="stroke-line-2" />
        {data.kind === 'bar' ? (
          data.series.map((s, i) => {
            const bw = Math.min(36, ((W - 2 * pad) / n) * 0.62)
            const top = y(s.value)
            return (
              <rect
                key={`${i}-${s.label}`}
                x={slot(i) - bw / 2}
                y={Math.min(top, base)}
                width={bw}
                height={Math.max(1, Math.abs(base - top))}
                rx={3}
                className="fill-brand"
              />
            )
          })
        ) : (
          <>
            <polyline fill="none" strokeWidth={2} className="stroke-brand" points={data.series.map((s, i) => `${slot(i)},${y(s.value)}`).join(' ')} />
            {data.series.map((s, i) => (
              <circle key={`${i}-${s.label}`} cx={slot(i)} cy={y(s.value)} r={3} className="fill-brand" />
            ))}
          </>
        )}
        {data.series.map((s, i) => (
          <text key={`${i}-${s.label}`} x={slot(i)} y={H + 10} textAnchor="middle" className="fill-fg-3 text-[9px]">
            {s.label}
          </text>
        ))}
      </svg>
    </BlockFrame>
  )
}

function Ideas({ data }: { data: BlockDataMap['ideas'] }) {
  return (
    <BlockFrame name="ideas">
      <ol className="space-y-2">
        {data.items.map((it, i) => (
          <li key={`${i}-${it.title}`} className="flex gap-3">
            <span className="pt-0.5 font-mono text-[11px] text-fg-4">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <div className="font-medium">{it.title}</div>
              {it.hook && <div className="text-[12.5px] text-fg-3">{it.hook}</div>}
            </div>
          </li>
        ))}
      </ol>
    </BlockFrame>
  )
}

function Concepts({ data }: { data: BlockDataMap['concepts'] }) {
  return (
    <BlockFrame name="concepts">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
        {data.items.map((c, i) => (
          <div key={`${i}-${c.title}`} className="rounded-field border border-line bg-surface-2 p-3">
            <div className="font-medium">{c.title}</div>
            <p className="mt-1 text-[12.5px] text-fg-2">{c.summary}</p>
            {c.tags && (
              <div className="mt-2 flex flex-wrap gap-1">
                {c.tags.map((g) => (
                  <span key={g} className="rounded-chip bg-surface-pop px-2 py-0.5 text-[11px] text-fg-3">
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </BlockFrame>
  )
}

function Beats({ data }: { data: BlockDataMap['beats'] }) {
  return (
    <BlockFrame name="beats">
      <ol className="relative space-y-2 border-l border-line-2 pl-4">
        {data.items.map((b, i) => (
          <li key={`${i}-${b.label}`} className="relative">
            <span aria-hidden className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-brand" />
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{b.label}</span>
              {b.seconds !== undefined && <span className="font-mono text-[11px] text-fg-4">{t('block.seconds', { n: b.seconds })}</span>}
            </div>
            <div className="text-[12.5px] text-fg-2">{b.text}</div>
          </li>
        ))}
      </ol>
    </BlockFrame>
  )
}

function Keywords({ data }: { data: BlockDataMap['keywords'] }) {
  const maxVol = Math.max(...data.items.map((k) => k.volume ?? 0), 1)
  return (
    <BlockFrame name="keywords">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-fg-4">
            <th className="font-normal">{t('block.keywords')}</th>
            <th className="font-normal">{t('block.volume')}</th>
            <th className="text-right font-normal">{t('block.difficulty')}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((k, i) => (
            <tr key={`${i}-${k.term}`} className="border-t border-line">
              <td className="py-1 pr-2">{k.term}</td>
              <td className="w-1/3 py-1 pr-2">
                {k.volume !== undefined && (
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(4, (k.volume / maxVol) * 100)}%` }} />
                    <span className="font-mono text-[11px] text-fg-3">{fmt(k.volume)}</span>
                  </div>
                )}
              </td>
              <td className="py-1 text-right font-mono text-[11px] text-fg-3">{k.difficulty !== undefined ? fmt(k.difficulty) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </BlockFrame>
  )
}

function Tags({ data }: { data: BlockDataMap['tags'] }) {
  return (
    <BlockFrame name="tags">
      <div className="flex flex-wrap gap-1.5">
        {data.items.map((g, i) => (
          <span key={`${i}-${g}`} className="rounded-chip border border-line-2 bg-surface-2 px-2.5 py-0.5 text-[12px] text-fg-2">
            #{g.replace(/^#/, '')}
          </span>
        ))}
      </div>
    </BlockFrame>
  )
}

/** Sources are shown by host: nothing in a chat message is ever opened or fetched by the app. */
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Sources({ data }: { data: BlockDataMap['sources'] }) {
  return (
    <BlockFrame name="sources">
      <ul className="space-y-1.5">
        {data.items.map((s, i) => (
          <li key={`${i}-${s.title}`} className="flex gap-2">
            <span className="pt-0.5 font-mono text-[11px] text-fg-4">[{i + 1}]</span>
            <div className="min-w-0">
              <div className="truncate font-medium">{s.title}</div>
              <div className="truncate text-[12px] text-fg-3">{[s.url ? host(s.url) : '', s.note ?? ''].filter(Boolean).join(' · ')}</div>
            </div>
          </li>
        ))}
      </ul>
    </BlockFrame>
  )
}

function Trend({ data }: { data: BlockDataMap['trend'] }) {
  const W = 200
  const H = 44
  const min = Math.min(...data.points)
  const span = Math.max(...data.points) - min || 1
  const xy = data.points.map((p, i): [number, number] => [(i * W) / (data.points.length - 1), H - 4 - ((p - min) / span) * (H - 8)])
  const last = xy[xy.length - 1] ?? [0, 0]
  return (
    <BlockFrame name="trend" {...(data.title ? { title: data.title } : {})}>
      <div className="flex items-center gap-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-48" role="img" aria-label={data.title ?? t('block.trend')}>
          <polyline fill="none" strokeWidth={2} className="stroke-brand" points={xy.map(([a, b]) => `${a},${b}`).join(' ')} />
          <circle cx={last[0]} cy={last[1]} r={3} className="fill-brand" />
        </svg>
        {data.delta && <span className={cn('font-mono text-[13px]', trendTone(data.delta))}>{data.delta}</span>}
      </div>
    </BlockFrame>
  )
}

function Steps({ data }: { data: BlockDataMap['steps'] }) {
  return (
    <BlockFrame name="steps">
      <ol className="space-y-1.5">
        {data.items.map((s, i) => (
          <li key={`${i}-${s.label}`} data-state={s.state} className={cn('flex items-center gap-2', s.state === 'todo' && 'text-fg-4')}>
            {s.state === 'done' ? (
              <Check className="size-4 text-ok" aria-hidden />
            ) : s.state === 'running' ? (
              <Loader2 className="size-4 animate-spin text-brand-fg" aria-hidden />
            ) : (
              <Circle className="size-4" aria-hidden />
            )}
            {s.label}
          </li>
        ))}
      </ol>
    </BlockFrame>
  )
}

export function RichBlock({ segment }: { segment: Extract<BodySegment, { kind: 'block' | 'pending' }> }) {
  if (segment.kind === 'pending') {
    return (
      <div data-testid="block-pending" className="rounded-card border border-dashed border-line-2 px-3 py-2 text-[12.5px] text-fg-3">
        {t('thread.pendingBlock')}
      </div>
    )
  }
  switch (segment.name) {
    case 'stats':
      return <Stats data={segment.data} />
    case 'chart':
      return <Chart data={segment.data} />
    case 'ideas':
      return <Ideas data={segment.data} />
    case 'concepts':
      return <Concepts data={segment.data} />
    case 'beats':
      return <Beats data={segment.data} />
    case 'keywords':
      return <Keywords data={segment.data} />
    case 'tags':
      return <Tags data={segment.data} />
    case 'sources':
      return <Sources data={segment.data} />
    case 'trend':
      return <Trend data={segment.data} />
    case 'steps':
      return <Steps data={segment.data} />
  }
}
