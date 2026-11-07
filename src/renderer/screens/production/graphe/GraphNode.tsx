// One brick on the pipeline graph (production-13, R11.2): its icon and French label, the lock of its gate, what makes it in
// plain words (never the provider or model: pipeline-ui), its cost per minute and its share of the total; during a run, its
// state, progress and credits instead of the price. A brick an option switched off is drawn greyed and dashed, with the
// option's name.
import {
  BadgeEuro,
  Captions,
  Clapperboard,
  FileText,
  Film,
  Image,
  Images,
  Languages,
  Layers,
  Lightbulb,
  Lock,
  Mic,
  Music,
  Package,
  PanelTop,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  UserRound,
  type LucideIcon
} from 'lucide-react'
import { engineFamilyOf } from '../../../../shared/cloud-engines'
import { t, type MessageKey } from '../../../../shared/fr'
import type { GraphNodeView } from '../../../../shared/pipeline-graph'
import { StatusDot } from '@/components/atelier/primitives'
import { cn } from '@/lib/utils'
import { NODE_TONE } from '../shared'
import type { BrickRunState } from './graph-run'
import { NODE_H, NODE_W, type Orientation } from './graph-layout'

const ICONS: Record<string, LucideIcon> = {
  idea: Lightbulb,
  research: Lightbulb,
  script: FileText,
  translate: Languages,
  sponsor: BadgeEuro,
  factcheck: SearchCheck,
  voice: Mic,
  director: Clapperboard,
  visuals: Images,
  avatar: UserRound,
  motion: Sparkles,
  background: Layers,
  card: PanelTop,
  captions: Captions,
  music: Music,
  render: Film,
  qc: ShieldCheck,
  thumbnail: Image,
  package: Package
}

/** What the brick costs, from the estimate (credits; null: it spends none). */
export interface BrickCost {
  perMinute: number
  perVideo: number
  share: number
  /** A brick that writes or directs with the team's LLM: included in the Claude subscription, or paid apart. */
  llm?: 'included' | 'paid'
}

const PORT = 'absolute size-2 rounded-full border border-line-3 bg-surface-1'
const NUM = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** What makes a brick, in plain words: the kind of work (« Voix Atelier »), or the computer. */
export function madeBy(node: GraphNodeView): string {
  const family = node.engine ? engineFamilyOf(node.engine) : null
  return t(family ? (`graph.made.${family}` as MessageKey) : 'graph.made.local')
}

function CostLine({ cost, creditEur }: { cost: BrickCost | null | undefined; creditEur: number }) {
  if (cost === undefined) return null
  if (cost?.llm) return <span className="shrink-0 whitespace-nowrap text-fg-3">{t(cost.llm === 'included' ? 'graph.cost.llm.included' : 'graph.cost.llm.paid')}</span>
  if (cost === null || (cost.perMinute === 0 && cost.perVideo === 0)) return <span className="shrink-0 whitespace-nowrap text-fg-4">{t('graph.cost.none')}</span>
  const eur = cost.perMinute > 0 ? t('graph.cost.min', { eur: NUM.format(cost.perMinute * creditEur) }) : t('graph.cost.video', { eur: NUM.format(cost.perVideo * creditEur) })
  return (
    <span className="num shrink-0 whitespace-nowrap text-fg-2" title={t('graph.cost.share', { pct: Math.round(cost.share * 100) })}>
      {eur}
      {cost.share > 0 && <span className="ml-1 text-fg-4">· {Math.round(cost.share * 100)} %</span>}
    </span>
  )
}

function RunLine({ run }: { run: BrickRunState }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-fg-2">
      <StatusDot tone={NODE_TONE[run.state]} pulse={run.state === 'running'} />
      <span className="truncate">{t(`runs.state.${run.state}` as MessageKey)}</span>
      {run.credits > 0 ? (
        <span className="num ml-auto shrink-0 text-fg-3">{t('graph.spent', { spent: run.credits })}</span>
      ) : run.quote > 0 ? (
        <span className="num ml-auto shrink-0 text-fg-4">{t('graph.quote', { quote: run.quote })}</span>
      ) : null}
    </span>
  )
}

export function GraphNode({
  node,
  x,
  y,
  cost,
  creditEur,
  run,
  hot,
  dim,
  orientation,
  onOpen,
  onHover
}: {
  node: GraphNodeView
  x: number
  y: number
  /** undefined: no estimate shown; null: it spends nothing. */
  cost: BrickCost | null | undefined
  creditEur: number
  run: BrickRunState | null
  hot: boolean
  dim: boolean
  orientation: Orientation
  onOpen?: (node: GraphNodeView) => void
  onHover: (id: string | null) => void
}) {
  const Icon = ICONS[node.kind] ?? Sparkles
  const label = t(node.labelKey as MessageKey)
  const made = madeBy(node)
  const off = node.off !== null
  const option = node.off ? t(node.off.labelKey as MessageKey) : ''
  const state = run?.state
  const bar = run ? run.progress : (cost?.share ?? 0)
  return (
    <button
      type="button"
      data-testid={`graph-node-${node.id}`}
      data-state={state ?? (off ? 'off' : 'idle')}
      data-gate={node.gate ? 'owner' : 'none'}
      title={off ? t('graph.off.title', { name: label, option }) : undefined}
      onClick={() => onOpen?.(node)}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
      className={cn(
        'group absolute flex flex-col gap-1 rounded-[12px] border bg-surface-1 px-2.5 pt-2 pb-2.5 text-left outline-none',
        'transition-[border-color,box-shadow,opacity] duration-[90ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        // greyed but opaque, so the lines behind it do not cross its text
        off ? 'border-dashed border-line-3 bg-bg *:opacity-50 hover:*:opacity-80' : 'border-line-2 hover:border-line-3',
        hot && !off && 'border-fg-3 shadow-[var(--shadow-pop)]',
        dim && 'opacity-45',
        state === 'running' && 'border-info shadow-[0_0_0_3px_var(--info-soft)]',
        state === 'waiting_gate' && 'border-warn shadow-[0_0_0_3px_var(--warn-soft)]',
        state === 'error' && 'border-err shadow-[0_0_0_3px_var(--err-soft)]',
        (state === 'done' || state === 'cached') && 'border-ok/50'
      )}
    >
      {/* the ports, n8n-like: what comes in first along the flow, what goes out last */}
      <span aria-hidden className={cn(PORT, orientation === 'horizontal' ? 'top-1/2 -left-[4.5px] -translate-y-1/2' : 'left-1/2 -top-[4.5px] -translate-x-1/2')} />
      <span aria-hidden className={cn(PORT, orientation === 'horizontal' ? 'top-1/2 -right-[4.5px] -translate-y-1/2' : 'left-1/2 -bottom-[4.5px] -translate-x-1/2')} />
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 text-fg-2',
            (state === 'done' || state === 'cached') && 'bg-ok/12 text-ok',
            state === 'running' && 'bg-info/12 text-info'
          )}
        >
          <Icon className="size-[15px]" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium tracking-[-0.006em] text-fg">{label}</span>
        {node.gate && (
          <span title={t('graph.gate')} aria-label={t('graph.gate')} data-testid={`graph-gate-${node.id}`} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-warn/15 text-warn">
            <Lock className="size-[11px]" strokeWidth={2.25} aria-hidden />
          </span>
        )}
      </span>
      <span className="truncate text-[11px] text-fg-3">{made}</span>
      <span className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
        {off ? (
          <span className="truncate text-fg-3">{t('graph.off', { option })}</span>
        ) : run ? (
          <RunLine run={run} />
        ) : (
          <>
            <span />
            <CostLine cost={cost} creditEur={creditEur} />
          </>
        )}
      </span>
      {!off && (
        <span aria-hidden className="mt-auto h-[3px] w-full overflow-hidden rounded-full bg-surface-2">
          <span
            className={cn('block h-full rounded-full transition-[width] duration-[240ms] ease-out', run ? (state === 'error' ? 'bg-err' : state === 'running' ? 'bg-info' : 'bg-ok') : 'bg-fg-3')}
            style={{ width: `${Math.round(Math.min(1, bar) * 100)}%` }}
          />
        </span>
      )}
    </button>
  )
}
