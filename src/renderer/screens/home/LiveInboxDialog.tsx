// Real mode: answering what really waits for the user. An agent's question (its text, the choices it offers, a free
// answer), a request for files, an alert about a stopped task (« Relancer »), or a production gate (« Valider » /
// « Demander des changements » with a note). The answer goes to the runtime or the engine through `resolveInbox`.
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import type { InboxAnswer, InboxItem } from '@/proto/types'

const TITLE = 'font-sans text-[18px] leading-tight font-semibold tracking-[-0.018em]'

/** The label of the row's button for a real item. */
export function liveActionLabel(item: InboxItem): string {
  const ref = item.live
  if (!ref) return ''
  if (ref.source === 'gate') return t('home.live.action.gate')
  if (ref.kind === 'alert') return t('home.live.action.alert')
  if (ref.kind === 'files') return t('home.live.action.files')
  return t('home.live.action.answer')
}

export function LiveInboxDialog({ item, onClose, onDone }: { item: InboxItem; onClose: () => void; onDone: (answer: InboxAnswer, message: string) => void }) {
  const ref = item.live
  const [text, setText] = useState('')
  const [changing, setChanging] = useState(false)
  if (!ref) return null
  const gate = ref.source === 'gate'
  const alert = !gate && ref.kind === 'alert'
  const body = gate ? t('home.live.gate.body', { node: ref.nodeLabel, pipeline: ref.pipelineLabel }) : ref.body
  const options = !gate && !alert ? ref.options : []
  // « Toujours valider pour ce type »: a validation of a video step of a channel (the rule is per channel and gate)
  const always = ref.source === 'orchestra' && ref.kind === 'validate' && !!ref.gate && ref.channelLiveId != null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,92vw)]" closeLabel={t('common.close')} data-testid="live-inbox-dialog">
        <DialogHeader>
          <DialogTitle className={TITLE}>{item.title}</DialogTitle>
          <DialogDescription>{item.detail}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[300px] overflow-y-auto rounded-[12px] border border-line-2 bg-surface-1 px-4 py-3.5 text-[13.5px] leading-[1.6] whitespace-pre-wrap text-fg-2" data-testid="live-inbox-body">
          {body || t('home.live.noBody')}
        </div>
        {gate && ref.demo && <p className="text-[12px] text-fg-3">{t('home.live.gate.demo')}</p>}

        {!alert && (!gate || changing) && (
          <Textarea
            autoFocus={changing}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={gate ? t('home.live.gate.notePlaceholder') : ref.source === 'orchestra' && ref.kind === 'files' ? t('home.live.files.placeholder') : t('home.live.answerPlaceholder')}
            aria-label={t('home.live.answerPlaceholder')}
            className="min-h-[80px]"
            data-testid="live-inbox-text"
          />
        )}

        <DialogFooter className="flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {gate ? (
            changing ? (
              <Button variant="outline" disabled={!text.trim()} onClick={() => onDone({ changes: true, text }, t('home.dash.done.changes'))}>
                {t('home.dash.script.sendChanges')}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setChanging(true)}>
                  {t('home.dash.script.askChanges')}
                </Button>
                <Button data-testid="live-inbox-approve" onClick={() => onDone({}, t('home.dash.done.generic'))}>
                  {t('common.validate')}
                </Button>
              </>
            )
          ) : alert ? (
            <>
              <Button variant="outline" onClick={() => onDone({ choice: 'dismiss' }, t('home.live.done.dismissed'))}>
                {t('home.live.dismiss')}
              </Button>
              <Button onClick={() => onDone({ choice: 'retry' }, t('home.live.done.retried'))}>
                <RotateCcw aria-hidden /> {t('home.live.retry')}
              </Button>
            </>
          ) : options.length > 0 ? (
            <>
              {always && (
                <>
                  {ref.series && (
                    <Button variant="ghost" data-testid="live-inbox-always-series" onClick={() => onDone({ always: 'series' }, t('home.live.done.always'))}>
                      {t('home.live.alwaysSeries', { series: ref.series })}
                    </Button>
                  )}
                  <Button variant="outline" data-testid="live-inbox-always" onClick={() => onDone({ always: 'type' }, t('home.live.done.always'))}>
                    {t('home.live.always', { gate: t(`goals.gate.${ref.gate}` as MessageKey) })}
                  </Button>
                </>
              )}
              {options.map((o, i) => (
                <Button key={o} variant={i === 0 ? 'default' : 'outline'} data-testid={`live-inbox-option-${i}`} onClick={() => onDone({ choice: o, text }, t('home.live.done.answered'))}>
                  {o}
                </Button>
              ))}
            </>
          ) : (
            <Button data-testid="live-inbox-send" disabled={ref.kind === 'files' && !text.trim()} onClick={() => onDone(text.trim() ? { text } : { choice: 'Valider' }, t('home.live.done.answered'))}>
              {text.trim() ? t('home.live.send') : t('common.validate')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
