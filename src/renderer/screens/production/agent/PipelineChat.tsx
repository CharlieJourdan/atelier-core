// The pipeline's conversation with the agent, in the pipeline editor (production-12, decision 0024 R10.1–R10.2): the owner
// writes (« moins cher »), the agent answers and may propose ONE change, shown as a diff in plain words with the cost per
// minute and the likeness before → after; « Accepter » saves it as a new version, « Refuser » keeps the pipeline. A batch
// the app refused shows its typed errors. Changes proposed by a team agent wait here too.
import { Check, Send, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../../../../shared/fr'
import type { ChangeView, ThreadView } from '../../../../shared/pipeline-agent'
import { SectionHead } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { call, errText } from '@/state/client'
import { eurOf } from '../recettes/estimate-format'
import { DiffLines } from './parts'

function PendingCard({ change, creditEur, busy, onAccept, onReject }: { change: ChangeView; creditEur: number; busy: boolean; onAccept: () => void; onReject: () => void }) {
  const fit = (n: number | null): string => (n === null ? '—' : `${n} %`)
  return (
    <div className="card flex flex-col gap-3 p-4 ring-1 ring-ink/30" data-testid="pending-change">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-[13px] font-semibold text-fg">{t('pchat.pending')}</h4>
        {change.author === 'team' && <span className="text-[11.5px] text-fg-3">{t('pchat.byTeam')}</span>}
        <span className="text-[12px] text-fg-3">{change.note}</span>
      </div>
      <DiffLines changes={change.changes} testId="pending-diff" />
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
        {change.perMinute && (
          <span className="num text-fg" data-testid="pending-cost">
            {t('pchat.cost', { before: eurOf(change.perMinute.before.avg, creditEur), after: eurOf(change.perMinute.after.avg, creditEur) })}
          </span>
        )}
        {(change.fit.before !== null || change.fit.after !== null) && (
          <span className="num text-fg-2" data-testid="pending-fit">
            {t('pchat.fit', { before: fit(change.fit.before), after: fit(change.fit.after) })}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={onAccept} data-testid="pending-accept">
          <Check />
          {t('pchat.accept')}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onReject} data-testid="pending-reject">
          <X />
          {t('pchat.reject')}
        </Button>
      </div>
    </div>
  )
}

export function PipelineChat({ recipeId, channelId, onSaved }: { recipeId: number; channelId: number | null; onSaved: (version: number) => void }) {
  const [thread, setThread] = useState<ThreadView | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    call('pipelineAgent.thread', recipeId, channelId).then(setThread, (e: unknown) => toast.error(errText(e)))
  }, [recipeId, channelId])
  useEffect(load, [load])

  const run = async (f: () => Promise<ThreadView>, after?: (t: ThreadView) => void): Promise<void> => {
    setBusy(true)
    try {
      const v = await f()
      setThread(v)
      after?.(v)
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const send = (): void => {
    const message = text.trim()
    if (!message) return
    setText('')
    void run(() => call('pipelineAgent.say', recipeId, message, channelId))
  }
  const who = (role: string): string => (role === 'user' ? t('pchat.you') : role === 'agent' ? t('pchat.agent') : t('pchat.app'))

  return (
    <section className="mb-8" data-testid="pipeline-chat">
      <SectionHead title={t('pchat.title')} />
      <p className="mb-3 text-[12px] text-fg-3">{t('pchat.hint')}</p>
      <div className="flex flex-col gap-2.5" data-testid="chat-messages">
        {thread && thread.messages.length === 0 && <p className="text-[12px] text-fg-4">{t('pchat.empty')}</p>}
        {thread?.messages.map((m) => (
          <div key={m.id} className={cn('flex max-w-[720px] flex-col gap-1 rounded-lg px-3 py-2 text-[12.5px] leading-[1.5]', m.role === 'user' ? 'self-end bg-ink text-ink-fg' : m.role === 'agent' ? 'bg-surface-2 text-fg' : 'text-fg-3')}>
            <span className={cn('text-[11px] font-medium', m.role === 'user' ? 'text-ink-fg/70' : 'text-fg-4')}>{who(m.role)}</span>
            <span className="whitespace-pre-wrap">{m.text}</span>
            {m.errors.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-[11.5px] text-warn" data-testid="message-errors">
                <li className="font-medium">{t('pchat.refused')}</li>
                {m.errors.map((e, i) => (
                  <li key={i} className="num">
                    [{e.code}] {e.op >= 0 ? `#${e.op + 1} ` : ''}
                    {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <p className="text-[12px] text-fg-3" data-testid="chat-thinking">{t('pchat.thinking')}</p>}
      </div>
      {thread?.pending && (
        <div className="mt-3">
          <PendingCard
            change={thread.pending}
            creditEur={thread.creditEur}
            busy={busy}
            onAccept={() =>
              void run(
                () => call('pipelineAgent.accept', recipeId, thread.pending?.id as number),
                (v) => {
                  toast.success(t('pchat.accepted', { n: v.version }))
                  onSaved(v.version)
                }
              )
            }
            onReject={() => void run(() => call('pipelineAgent.reject', recipeId, thread.pending?.id as number))}
          />
        </div>
      )}
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          data-testid="chat-input"
          rows={2}
          value={text}
          placeholder={t('pchat.placeholder')}
          aria-label={t('pchat.title')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          className="min-w-0 flex-1 resize-none rounded-md bg-surface px-3 py-2 text-[12.5px] text-fg ring-1 ring-line placeholder:text-fg-3 focus-visible:outline-2 focus-visible:outline-ring"
        />
        <Button type="submit" size="sm" disabled={busy || !text.trim()} data-testid="chat-send">
          <Send />
          {t('pchat.send')}
        </Button>
      </form>
    </section>
  )
}
