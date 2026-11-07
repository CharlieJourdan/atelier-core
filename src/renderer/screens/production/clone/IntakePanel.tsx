// P0 on screen: a short conversation on the left, the brief it is writing on the right. The brief changes with every message
// and the agent says exactly what changed (before → after), or says that nothing did and why. Cards and chips answer the
// question in one click; the composer takes anything free.
import { ArrowUp, Check, Copy, Film, Languages, Lightbulb, Shuffle, Sparkles, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { INSPIRATION_AXES, type CloneIntent, type IntakeField, type IntakeState, type IntakeTurn } from '../../../../shared/clone'
import { tc } from '../../../../shared/fr-clone'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { changeText, fieldLabel, usd, valueText } from './format'
import './clone.css'

export type ChatLine = { id: number; role: 'user'; text: string } | { id: number; role: 'agent'; turn: IntakeTurn | null }

const ICONS: Record<CloneIntent, typeof Copy> = { 'own-channel': UserRound, 'copy-channel': Copy, 'copy-video': Film, translate: Languages, inspiration: Lightbulb, mix: Shuffle }
const INTENTS: CloneIntent[] = ['copy-channel', 'own-channel', 'copy-video', 'translate', 'inspiration', 'mix']

/** Quick answers for the question being asked (one click = one message). */
export function quickReplies(asked: IntakeField | null): { label: string; say: string }[] {
  switch (asked) {
    case 'humanInputs': return [
      { label: tc('clone.intake.quick.face'), say: 'Je peux fournir mon visage' }, { label: tc('clone.intake.quick.voice'), say: 'Je peux fournir ma voix' },
      { label: tc('clone.intake.quick.footage'), say: 'Je peux fournir mes images' }, { label: tc('clone.intake.quick.no'), say: 'Rien, des provisoires' }
    ]
    case 'testBudgetUsd': return [5, 10, 20].map((n) => ({ label: tc('clone.intake.quick.budget', { usd: n }), say: `${n} $` }))
    case 'language': return ['fr', 'en', 'es'].map((l) => ({ label: tc(`clone.lang.${l}`), say: tc(`clone.lang.${l}`) }))
    case 'sourceLanguage': return ['en', 'fr', 'es'].map((l) => ({ label: tc(`clone.lang.${l}`), say: tc(`clone.lang.${l}`) }))
    default: return []
  }
}

function ChangeRows({ turn }: { turn: IntakeTurn }) {
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0" aria-label={tc('clone.intake.reply.changed', { n: turn.changes.length })}>
      {turn.changes.map((c) => {
        const v = changeText(c)
        return (
          <li key={c.field} className="clone-rise flex flex-wrap items-baseline gap-x-2 rounded-[10px] bg-brand-soft px-2.5 py-1.5 text-[12.5px] ring-1 ring-brand-line" data-testid="intake-change">
            <span className="font-medium text-fg">{v.field}</span>
            {c.before !== '' && <span className="text-fg-3 line-through decoration-fg-4">{v.before}</span>}
            <span className="text-fg-3" aria-hidden>→</span>
            <span className="font-medium text-brand-fg">{v.after}</span>
          </li>
        )
      })}
    </ul>
  )
}

function AgentBubble({ turn, hello }: { turn: IntakeTurn | null; hello: boolean }) {
  return (
    <div className="clone-rise flex max-w-[92%] flex-col gap-1.5 self-start" data-testid="agent-line">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-fg-3"><Sparkles className="size-3 text-brand-fg" aria-hidden />{tc('clone.agent')}</span>
      <div className="rounded-[14px] rounded-tl-[4px] bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-fg ring-1 ring-line">
        {hello && <p className="m-0">{tc('clone.intake.hello')}</p>}
        {turn?.reply.map((r, i) => <p key={i} className={cn('m-0', i > 0 && 'mt-1.5 text-fg-2')}>{tc(r.key, r.vars)}</p>)}
        {turn && turn.changes.length > 0 && <ChangeRows turn={turn} />}
        {turn?.question && <p className="m-0 mt-2 font-medium">{tc(turn.question)}</p>}
        {turn?.ready && <p className="m-0 mt-2 flex items-center gap-1.5 font-medium text-brand-fg"><Check className="size-3.5" aria-hidden />{tc('clone.intake.ready')}</p>}
      </div>
    </div>
  )
}

/** The brief as it stands: a row per field, the rows the last message changed flash. */
export function BriefCard({ state, changed, ready, missing, onStart, starting }: { state: IntakeState; changed: IntakeField[]; ready: boolean; missing: IntakeField[]; onStart: () => void; starting?: boolean }) {
  const d = state.draft
  const raw: Record<string, string> = {
    intent: d.intent ?? '',
    references: d.references.map((r) => r.url).join(' | '),
    language: d.language ?? '',
    sourceLanguage: d.intent === 'translate' ? (d.sourceLanguage ?? '') : '',
    testBudgetUsd: d.testBudgetUsd === null ? '' : String(d.testBudgetUsd),
    humanInputs: d.humanInputs ? (['face', 'voice', 'footage'] as const).filter((k) => d.humanInputs![k]).join(',') || 'none' : '',
    style: d.style === undefined ? 'auto' : d.style === null ? 'auto' : d.style
  }
  const fields: IntakeField[] = d.intent === 'translate' ? ['intent', 'references', 'sourceLanguage', 'language', 'testBudgetUsd', 'humanInputs', 'style'] : ['intent', 'references', 'language', 'testBudgetUsd', 'humanInputs', 'style']
  return (
    <aside className="flex flex-col gap-3 rounded-card bg-surface-1 p-4 ring-1 ring-line-2 shadow-[var(--shadow-card)]" aria-label={tc('clone.brief.title')} data-testid="brief-card">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[14px] font-semibold text-fg">{tc('clone.brief.title')}</h2>
        <span className="text-[11px] text-fg-3">{tc('clone.brief.live')}</span>
      </header>
      <dl className="m-0 flex flex-col gap-0.5">
        {fields.map((f) => {
          const value = raw[f] ?? ''
          const empty = value === '' || (f === 'style' && d.style === undefined)
          return (
            <div key={`${f}-${changed.includes(f) ? state.said.length : 0}`} className={cn('grid grid-cols-[104px_1fr] gap-2 rounded-[8px] px-2 py-1.5', changed.includes(f) && 'clone-flash')} data-testid={`brief-${f}`}>
              <dt className="text-[11.5px] leading-[1.4] text-fg-3">{fieldLabel(f)}</dt>
              <dd className={cn('m-0 min-w-0 break-words text-[12.5px] leading-[1.4]', empty ? 'text-fg-3' : 'font-medium text-fg')}>
                {f === 'references' && d.references.length > 0 ? (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {d.references.map((r) => (
                      <li key={r.url} className="min-w-0">
                        <span className="mr-1.5 rounded-[4px] bg-surface-3 px-1 py-px text-[10px] font-medium text-fg-2">{tc(`clone.ref.${r.kind}`)}</span>
                        <span className="break-all">{valueText('references', r.url)}</span>
                        {r.axes.length > 0 && <span className="block text-[11px] font-normal text-fg-3">{r.axes.filter((a) => (INSPIRATION_AXES as readonly string[]).includes(a)).map((a) => tc(`clone.axis.${a}`)).join(', ')}</span>}
                      </li>
                    ))}
                  </ul>
                ) : empty && f !== 'style' ? tc('clone.brief.empty') : valueText(f, value)}
              </dd>
            </div>
          )
        })}
      </dl>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <Button onClick={onStart} disabled={!ready || starting} size="lg" className="w-full">{tc('clone.brief.start')}</Button>
        <p className="m-0 text-center text-[11.5px] text-fg-3" data-testid="brief-hint">{ready ? tc('clone.brief.startHint') : tc('clone.brief.notReady', { n: missing.length })}</p>
      </div>
    </aside>
  )
}

export interface IntakePanelProps {
  lines: ChatLine[]
  state: IntakeState
  latest: IntakeTurn | null
  onSend: (text: string) => void
  onStart: () => void
  busy?: boolean
}

export function IntakePanel({ lines, state, latest, onSend, onStart, busy }: IntakePanelProps) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [lines.length])
  const send = (v: string): void => { const m = v.trim(); if (m && !busy) { onSend(m); setText('') } }
  const fresh = lines.length === 0 && state.draft.intent === null
  // an optional question (what he supplies) keeps its quick answers once the brief can start
  const chips = quickReplies(state.asked)
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="intake-panel">
      <section className="flex min-h-[520px] flex-col rounded-card bg-surface-1 ring-1 ring-line-2 shadow-[var(--shadow-card)]" aria-label={tc('clone.stage.intake')}>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" role="log" aria-live="polite">
          <AgentBubble turn={null} hello />
          {fresh && (
            <div className="clone-rise grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="intent-cards">
              {INTENTS.map((k) => {
                const Icon = ICONS[k]
                return (
                  <button key={k} type="button" onClick={() => send(tc(`clone.intent.${k}.say`))} className="group flex flex-col items-start gap-1.5 rounded-[12px] bg-surface-2 p-3 text-left ring-1 ring-line-2 transition hover:bg-surface-3 hover:ring-brand-line focus-visible:ring-2 focus-visible:ring-brand" data-testid={`intent-${k}`}>
                    <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand-fg"><Icon className="size-4" aria-hidden /></span>
                    <span className="text-[13px] font-semibold text-fg">{tc(`clone.intent.${k}.title`)}</span>
                    <span className="text-[11.5px] leading-[1.4] text-fg-3">{tc(`clone.intent.${k}.hint`)}</span>
                  </button>
                )
              })}
            </div>
          )}
          {lines.map((l) => l.role === 'user'
            ? <p key={l.id} className="clone-rise m-0 max-w-[85%] self-end rounded-[14px] rounded-tr-[4px] bg-brand px-3.5 py-2 text-[13.5px] leading-[1.5] text-brand-ink" data-testid="user-line">{l.text}</p>
            : <AgentBubble key={l.id} turn={l.turn} hello={false} />)}
          <div ref={end} />
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2" data-testid="quick-replies">
            {chips.map((c) => <button key={c.label} type="button" onClick={() => send(c.say)} className="rounded-full bg-surface-2 px-3 py-1 text-[12px] font-medium text-fg-2 ring-1 ring-line-2 transition hover:bg-surface-3 hover:text-fg">{c.label}</button>)}
          </div>
        )}
        <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(text) }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }} rows={1} placeholder={tc('clone.composer.placeholder')} aria-label={tc('clone.composer.placeholder')}
            className="max-h-32 min-h-9 flex-1 resize-none rounded-[12px] bg-surface-2 px-3 py-2 text-[13.5px] text-fg outline-none ring-1 ring-line-2 placeholder:text-fg-3 focus:ring-brand" />
          <Button type="submit" size="icon" disabled={busy || text.trim() === ''} aria-label={tc('clone.send')}><ArrowUp /></Button>
        </form>
      </section>
      <BriefCard state={state} changed={latest?.changes.map((c) => c.field) ?? []} ready={latest?.ready ?? false} missing={latest?.missing ?? ['intent']} onStart={onStart} />
    </div>
  )
}

export { usd }
