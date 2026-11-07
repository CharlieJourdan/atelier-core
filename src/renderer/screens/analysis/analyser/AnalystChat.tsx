// The Analyste chat: a real model call (the user's Claude Code, priced in the ledger). The reply may carry one validated
// adjustment (answers, replacements, mode, budget, minutes, script), applied to the analysis; it is shown as a chip.
import { Loader2, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { ComponentId, InputId } from '../../../../shared/gauge'
import type { Adjust, AnalysisDetail, AnalysisMessage } from '../../../../shared/analysis'
import { Panel } from '@/components/atelier/primitives'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText } from '@/state/client'

/** What an adjustment changed, in French, one short phrase per field. */
export function adjustSummary(a: Adjust): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(a.answers ?? {})) out.push(t('analysis.chat.applied.answer', { input: t(`analysis.input.${k as InputId}`), value: v ? t('analysis.input.yes') : t('analysis.input.no') }))
  for (const [from, to] of Object.entries(a.replace ?? {})) {
    out.push(t('analysis.chat.applied.replace', { from: t(`analysis.comp.${from as ComponentId}`), to: t(`analysis.comp.${to as ComponentId}`) }))
  }
  if (a.mode) out.push(t('analysis.chat.applied.mode', { mode: t(`analysis.mode.${a.mode}`) }))
  if (a.maxCreditsPerVideo !== undefined) out.push(t('analysis.chat.applied.budget', { n: a.maxCreditsPerVideo }))
  if (a.minutes !== undefined) out.push(t('analysis.chat.applied.minutes', { n: a.minutes }))
  if (a.script?.length) out.push(t('analysis.chat.applied.length', { v: a.script.length }))
  if (a.script?.tone) out.push(t('analysis.chat.applied.tone', { v: a.script.tone }))
  return out
}

export function MessageBubble({ message }: { message: AnalysisMessage }) {
  const mine = message.author === 'user'
  const summary = message.applied ? adjustSummary(message.applied) : []
  return (
    <li data-testid={`analysis-message-${message.id}`} className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <div className={cn('max-w-[85%] rounded-card px-3.5 py-2 text-[13px] leading-[1.5] whitespace-pre-wrap', mine ? 'bg-brand text-ink-fg' : 'border border-line bg-surface-2 text-fg')}>{message.body}</div>
      {summary.length > 0 && (
        <p className="max-w-[85%] rounded-full border border-ok/30 bg-ok/10 px-2.5 py-0.5 text-[11.5px] text-ok" data-testid="applied-chip">
          {t('analysis.chat.applied.title')} : {summary.join(' · ')}
        </p>
      )}
    </li>
  )
}

export function AnalystChat({ detail, onDone }: { detail: AnalysisDetail; onDone: (before: number | null) => void }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [rejected, setRejected] = useState(false)
  const endRef = useRef<HTMLLIElement | null>(null)
  useEffect(() => endRef.current?.scrollIntoView?.({ block: 'nearest' }), [detail.messages.length, pending])

  const send = async () => {
    const body = text.trim()
    if (!body || pending) return
    setPending(true)
    setRejected(false)
    const before = detail.gauge?.score ?? null
    try {
      const res = await call('analysis.chat', detail.id, body)
      setText('')
      setRejected(res.adjustRejected)
      onDone(before)
    } catch (err) {
      toast.error(errText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel title={t('analysis.chat.title')} data-testid="analyst-chat">
      <p className="mb-3 text-[12.5px] text-fg-3">{t('analysis.chat.blurb')}</p>
      <ul className="mb-3 flex max-h-96 flex-col gap-3 overflow-auto pr-1" aria-live="polite" aria-label={t('analysis.chat.title')}>
        {detail.messages.length === 0 && !pending && <li className="text-[12.5px] text-fg-3">{t('analysis.chat.empty')}</li>}
        {detail.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {pending && (
          <li data-testid="analyst-pending" className="flex items-center gap-2 text-[12.5px] text-fg-3">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {t('analysis.chat.pending')}
          </li>
        )}
        <li ref={endRef} aria-hidden />
      </ul>
      {rejected && (
        <p role="alert" className="mb-2 rounded-field border border-warn/30 bg-warn/10 px-3 py-1.5 text-[12.5px] text-warn">
          {t('analysis.chat.rejected')}
        </p>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <Textarea
          value={text}
          rows={2}
          disabled={pending}
          aria-label={t('analysis.chat.placeholder')}
          placeholder={t('analysis.chat.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <Button type="submit" variant="brand" size="icon" disabled={pending || !text.trim()} aria-label={t('analysis.chat.send')} data-testid="analyst-send">
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
    </Panel>
  )
}
