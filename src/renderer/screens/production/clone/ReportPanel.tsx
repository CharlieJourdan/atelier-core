// P10 on screen: the verdict first, then pictures. The example (only one the blind judge passed) with its measured cost and
// making time, the reference and ours side by side at the same moments, a bar per axis with what differs, what he must
// supply and what stands in meanwhile, and the proposals each with a preview, a price, a time and a look.
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Coins, ImageOff, OctagonX, PackageOpen, ShieldQuestion } from 'lucide-react'
import type { FeasibilityVerdict, Report } from '../../../../shared/clone'
import { tc, tx } from '../../../../shared/fr-clone'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ClipPlayer, Frame } from './files'
import { clock, minutes, usd } from './format'
import './clone.css'

const VERDICT_TONE: Record<FeasibilityVerdict, { bar: string; chip: string }> = {
  reproducible: { bar: 'bg-ok', chip: 'bg-ok-soft text-ok' },
  'reproducible-with-human-inputs': { bar: 'bg-ok', chip: 'bg-ok-soft text-ok' },
  partly: { bar: 'bg-warn', chip: 'bg-warn-soft text-warn' },
  'not-reproducible': { bar: 'bg-err', chip: 'bg-err-soft text-err' }
}

function Section({ title, hint, children, id }: { title: string; hint?: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="clone-rise flex flex-col gap-3 rounded-card bg-surface-1 p-5 ring-1 ring-line-2 shadow-[var(--shadow-card)]" aria-label={title} data-testid={id}>
      <header className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[15px] font-semibold text-fg">{title}</h2>
        {hint && <p className="m-0 text-[12px] text-fg-3">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

function Verdict({ r }: { r: Report }) {
  const tone = VERDICT_TONE[r.verdict]
  const Icon = r.outcome === 'cloned' ? CheckCircle2 : r.outcome === 'not-reproducible' ? OctagonX : r.outcome === 'stopped-budget' ? Coins : ShieldQuestion
  const pct = Math.round(r.reproducibleShare * 100)
  return (
    <section className="clone-rise flex flex-col gap-4 rounded-card bg-surface-1 p-5 ring-1 ring-line-2 shadow-[var(--shadow-card)] sm:flex-row sm:items-center" data-testid="report-verdict" data-outcome={r.outcome}>
      <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-[16px]', tone.chip)}><Icon className="size-7" aria-hidden /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="m-0 text-[20px] font-semibold leading-tight text-fg">{tc(`clone.verdict.${r.verdict}.title`)}</h2>
        <p className="m-0 text-[13.5px] leading-[1.5] text-fg-2" data-testid="report-summary">{tx(r.summaryKey, r.summaryVars)}</p>
        <div className="flex items-center gap-3">
          <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct} % ${tc('clone.verdict.share')}`} className="h-2 max-w-[260px] flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <span className="text-[12px] text-fg-3"><b className="font-semibold text-fg tabular-nums">{pct} %</b> {tc('clone.verdict.share')}</span>
        </div>
      </div>
    </section>
  )
}

function Tile({ icon: Icon, value, unit, label, measured }: { icon: typeof Coins; value: string | null; unit: string; label: string; measured: boolean }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-[12px] bg-surface-2 p-3.5 ring-1 ring-line-2">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg-3"><Icon className="size-3.5" aria-hidden />{label}</span>
      {value !== null ? <p className="m-0 text-[22px] font-semibold leading-none text-fg tabular-nums">{value}<span className="ml-1 text-[12px] font-normal text-fg-3">{unit}</span></p> : <p className="m-0 text-[14px] text-fg-3">{tc('clone.report.notMeasured')}</p>}
      {value !== null && measured && <span className="text-[11px] text-fg-3">{tc('clone.report.measured')}</span>}
    </div>
  )
}

function Example({ r }: { r: Report }) {
  if (!r.example) {
    return (
      <Section title={tc('clone.report.example')} id="report-example">
        <div className="flex items-start gap-3 rounded-[12px] bg-surface-2 p-4 ring-1 ring-line-2" data-testid="report-no-example">
          <ImageOff className="mt-0.5 size-5 shrink-0 text-fg-3" aria-hidden />
          <div><p className="m-0 text-[13.5px] font-medium text-fg">{tc('clone.report.example.none')}</p><p className="m-0 mt-0.5 text-[12.5px] text-fg-3">{r.outcome === 'stopped-budget' ? tc('clone.report.example.noneBudget') : tc('clone.report.example.noneWhy')}</p></div>
        </div>
      </Section>
    )
  }
  return (
    <Section title={tc('clone.report.example')} hint={tc('clone.report.example.facts', { duration: minutes(r.example.durationS), usd: r.usdPerMinute === null ? '?' : `${usd(r.usdPerMinute)} $`, make: r.makeMinutesPerMinute === null ? '?' : usd(r.makeMinutesPerMinute) })} id="report-example">
      <ClipPlayer rel={r.example.videoPath} className="max-w-[760px]" />
    </Section>
  )
}

function SideBySide({ r }: { r: Report }) {
  if (r.sideBySide.length === 0) return null
  return (
    <Section title={r.framesFrom === 'last-round' ? tc('clone.report.sidebyside.last') : tc('clone.report.sidebyside')} id="report-frames">
      <div className="clone-strip">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {r.sideBySide.map((p) => <Frame key={p.sideBySide} rel={p.sideBySide} alt={`${tc('clone.report.reference')} / ${tc('clone.report.ours')} ${tc('clone.report.at', { time: clock(p.atS) })}`} time={clock(p.atS)} labels={[tc('clone.report.reference'), tc('clone.report.ours')]} className="[&_img]:aspect-[32/9]" />)}
        </div>
      </div>
    </Section>
  )
}

function Scores({ r }: { r: Report }) {
  if (r.axisScores.length === 0) return null
  return (
    <Section title={tc('clone.report.scores')} hint={tc('clone.report.scores.hint')} id="report-scores">
      <ul className="m-0 grid list-none gap-x-6 gap-y-3 p-0 sm:grid-cols-2">
        {r.axisScores.map((s) => (
          <li key={s.axis} className="flex flex-col gap-1" data-testid={`score-${s.axis}`}>
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]"><span className="font-medium text-fg">{tc(`clone.cmp.${s.axis}`)}</span></div>
            <div role="progressbar" aria-valuenow={Math.round(s.score)} aria-valuemin={0} aria-valuemax={100} aria-label={tc(`clone.cmp.${s.axis}`)} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div className={cn('h-full rounded-full', s.score >= 90 ? 'bg-ok' : s.score >= 70 ? 'bg-brand' : 'bg-warn')} style={{ width: `${Math.max(2, s.score)}%` }} />
            </div>
            <p className="m-0 text-[11.5px] leading-[1.4] text-fg-3">{s.defects.length === 0 ? tc('clone.report.noDefect') : s.defects.join(' · ')}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Inputs({ r }: { r: Report }) {
  return (
    <Section title={tc('clone.report.inputs')} id="report-inputs">
      {r.humanInputs.length === 0 ? <p className="m-0 flex items-center gap-2 text-[13px] text-fg-2"><PackageOpen className="size-4 text-fg-3" aria-hidden />{tc('clone.report.inputs.none')}</p> : (
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
          {r.humanInputs.map((h) => (
            <li key={h.slot} className="flex flex-col gap-1 rounded-[12px] bg-surface-2 p-3 ring-1 ring-line-2" data-testid={`input-${h.slot}`}>
              <span className="text-[13px] font-semibold text-fg">{h.what}</span>
              <span className={cn('text-[12px] leading-[1.4]', h.placeholder ? 'text-fg-2' : 'text-fg-3')}>{h.placeholder ? tc('clone.report.inputs.meanwhile', { placeholder: h.placeholder }) : tc('clone.report.inputs.nothing')}</span>
              {r.ingredients.find((g) => g.slot === h.slot) && (
                <ul className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0" aria-label={h.what}>
                  {r.ingredients.find((g) => g.slot === h.slot)!.options.map((o) => {
                    const now = r.ingredients.find((g) => g.slot === h.slot)!.current === o
                    return <li key={o} className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1', now ? 'bg-brand-soft text-brand-fg ring-brand-line' : 'bg-surface-3 text-fg-2 ring-line-2')} data-testid={`option-${h.slot}-${o}`} data-now={now}>{tc(`clone.ingredient.${o}`)}{now ? ` · ${tc('clone.report.ingredient.now')}` : ''}</li>
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Cannot({ r }: { r: Report }) {
  if (r.cannot.length === 0) return null
  return (
    <Section title={tc('clone.report.cannot')} id="report-cannot">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {r.cannot.map((c) => (
          <li key={c.what} className="flex flex-col gap-1" data-testid="cannot-row">
            <div className="flex items-baseline justify-between gap-3 text-[13px]"><span className="font-medium text-fg">{c.what}</span><span className="shrink-0 text-[12px] text-fg-3 tabular-nums">{tc('clone.report.cannot.share', { share: Math.round(c.share * 100) })}</span></div>
            <div role="progressbar" aria-valuenow={Math.round(c.share * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={c.what} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-err" style={{ width: `${Math.max(2, c.share * 100)}%` }} /></div>
            <p className="m-0 text-[11.5px] text-fg-3">{[c.technology, c.buildCostUsd !== null ? tc('clone.report.cannot.build', { usd: usd(c.buildCostUsd) }) : '', c.importCostUsd !== null ? tc('clone.report.cannot.import', { usd: usd(c.importCostUsd) }) : ''].filter(Boolean).join(' · ')}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Tech({ r }: { r: Report }) {
  if (r.technologies.length === 0) return null
  return (
    <Section title={tc('clone.report.tech')} hint={tc('clone.report.tech.hint')} id="report-tech">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {r.technologies.map((t) => <li key={t.node + t.role} className="flex flex-col rounded-[10px] bg-surface-2 px-2.5 py-1.5 ring-1 ring-line-2"><span className="font-mono text-[11.5px] text-fg">{t.node}</span><span className="text-[11px] text-fg-3">{t.role}</span></li>)}
      </ul>
    </Section>
  )
}

function Costs({ r, budget }: { r: Report; budget: number | null }) {
  return (
    <Section title={tc('clone.report.cost')} id="report-costs">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Tile icon={Coins} label={tc('clone.report.cost.per')} value={r.usdPerMinute === null ? null : usd(r.usdPerMinute)} unit="$" measured={r.example !== null} />
        <Tile icon={Clock} label={tc('clone.report.time.per')} value={r.makeMinutesPerMinute === null ? null : usd(r.makeMinutesPerMinute)} unit="min" measured={r.example !== null} />
      </div>
      <p className="m-0 text-[11.5px] text-fg-3">{budget !== null ? tc('clone.report.spent', { spent: usd(r.spentUsd), budget: usd(budget) }) : tc('clone.report.spent', { spent: usd(r.spentUsd), budget: '?' })} · {tc('clone.report.rounds', { n: r.rounds })}</p>
    </Section>
  )
}

function Alert({ r }: { r: Report }) {
  // A clone that only needs his inputs is good news, told by « ce que tu dois fournir »: the alert is for what cannot be done.
  if (!r.alert || r.verdict === 'reproducible' || r.verdict === 'reproducible-with-human-inputs') return null
  return (
    <section className="clone-rise flex flex-col gap-3 rounded-card bg-warn-soft p-5 ring-1 ring-warn" data-testid="report-alert" role="alert">
      <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold text-fg"><AlertTriangle className="size-4 text-warn" aria-hidden />{tc('clone.report.alert')}</h2>
      <p className="m-0 text-[13.5px] leading-[1.5] text-fg">{r.alert}</p>
    </section>
  )
}

/** A proposal's title in words: a slot proposal names what he supplies (the plan's own wording), not an id. */
const titleOf = (r: Report, title: string): string => {
  const slot = title.startsWith('clone.proposal.slot:') ? r.humanInputs.find((h) => h.slot === title.slice('clone.proposal.slot:'.length)) : undefined
  return slot ? tc('clone.proposal.slot', { slot: slot.what }) : tx(title)
}

const alternative = (r: Report, title: string): Report['alternatives'][number] | undefined => r.alternatives.find((a) => a.title === title)

function Proposals({ r }: { r: Report }) {
  if (r.proposals.length === 0) return null
  return (
    <Section title={r.outcome === 'not-reproducible' ? tc('clone.report.alternatives') : tc('clone.report.proposals')} hint={tc('clone.report.proposals.hint')} id="report-proposals">
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {r.proposals.map((p) => (
          <li key={p.title} className="flex flex-col gap-2 overflow-hidden rounded-[12px] bg-surface-2 p-2.5 ring-1 ring-line-2" data-testid="proposal">
            {p.previewPath ? <Frame rel={p.previewPath} alt={titleOf(r, p.title)} /> : <div className="flex aspect-video w-full items-center justify-center rounded-[8px] bg-surface-3 text-[11.5px] text-fg-3">{tc('clone.report.preview.none')}</div>}
            <h3 className="m-0 px-0.5 text-[13.5px] font-semibold leading-snug text-fg">{titleOf(r, p.title)}</h3>
            <p className="m-0 px-0.5 text-[12px] leading-[1.45] text-fg-3">{tx(p.look)}</p>
            {alternative(r, p.title) && (
              <p className="m-0 px-0.5 text-[11.5px] text-fg-3">{tc('clone.report.alternative.keeps')} : {(['topic', 'tone', 'structure', 'palette'] as const).filter((k) => alternative(r, p.title)!.keeps[k]).map((k) => tc(`clone.report.alternative.${k}`)).join(', ')}</p>
            )}
            <div className="mt-auto flex flex-wrap gap-1.5 px-0.5 pt-1 text-[11.5px] font-medium">
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-fg-2 tabular-nums">{p.usdPerMinute === null ? tc('clone.report.price.unknown') : tc('clone.report.price.pill', { usd: usd(p.usdPerMinute) })}</span>
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-fg-2 tabular-nums">{p.makeMinutesPerMinute === null ? tc('clone.report.time.unknown') : tc('clone.report.time.pill', { make: usd(p.makeMinutesPerMinute) })}</span>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function ReportPanel({ report, budgetUsd, onAgain, onNew }: { report: Report; budgetUsd: number | null; onAgain?: (budgetUsd?: number) => void; onNew?: () => void }) {
  const [more, setMore] = useState(() => String(Math.ceil((budgetUsd ?? 5) * 1.5)))
  const moreUsd = Number(more.replace(',', '.'))
  const valid = Number.isFinite(moreUsd) && moreUsd > (budgetUsd ?? 0) && moreUsd <= 1000
  return (
    <div className="flex flex-col gap-4" data-testid="report-panel">
      <Verdict r={report} />
      <Alert r={report} />
      <Cannot r={report} />
      {report.outcome !== 'not-reproducible' && <Example r={report} />}
      <SideBySide r={report} />
      <Scores r={report} />
      {report.outcome !== 'not-reproducible' && <Inputs r={report} />}
      {report.outcome !== 'not-reproducible' && <Costs r={report} budget={budgetUsd} />}
      {report.outcome !== 'not-reproducible' && <Tech r={report} />}
      <Proposals r={report} />
      {(onAgain || onNew) && (
        <div className="flex flex-wrap gap-2">
          {onAgain && report.outcome === 'stopped-budget' && (
            <span className="flex items-center gap-2">
              <input aria-label={tc('clone.report.again.budget')} inputMode="decimal" value={more} onChange={(e) => setMore(e.target.value)} className="w-20 rounded-[10px] bg-surface-1 px-2 py-1.5 text-[13px] text-fg ring-1 ring-line-2" data-testid="again-budget" />
              <span className="text-[12.5px] text-fg-3">$</span>
              <Button disabled={!valid} onClick={() => onAgain(moreUsd)}>{tc('clone.report.again')}</Button>
            </span>
          )}
          {onNew && <Button variant="secondary" onClick={onNew}>{tc('clone.report.new')}</Button>}
        </div>
      )}
    </div>
  )
}
