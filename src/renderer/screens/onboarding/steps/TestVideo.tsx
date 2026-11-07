// Step 7: the test video. The agent runs the proposed pipeline end to end (fast demo animation), then shows the result
// and asks what to change. "Relancer" runs it again with the feedback, "C'est bon" moves on.
import { Check, Loader2, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import { fmtDuration, ProgressBar, Thumb } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { TEST_FEEDBACK_CHIPS } from '@/proto/data-onboarding'
import { useProto } from '@/proto/store'
import { reportOf, sourceKind, type StepProps } from '../model'
import { Chip, Question, useElapsed } from '../parts'
import { columnsOf } from './Report'

const RUN_MS = 6000

function titleKeyOf(a: StepProps['a']) {
  const report = reportOf(a)
  if (report.kind === 'sms') return 'onb.test.title.sms' as const
  const kind = sourceKind(a)
  return kind === 'own' ? ('onb.test.title.own' as const) : kind === 'translate' ? ('onb.test.title.translate' as const) : ('onb.test.title.new' as const)
}

export function TestVideoStep({ a, next, ready, setReady }: StepProps) {
  const { pipelines } = useProto()
  const report = reportOf(a)
  const pipeline = pipelines.find((p) => p.id === report.pipelineId)
  const columns = pipeline ? columnsOf(pipeline.nodes) : []
  const { elapsed, restart, skip } = useElapsed(RUN_MS, 100)
  const [version, setVersion] = useState(1)
  const [chips, setChips] = useState<MessageKey[]>([])
  const [note, setNote] = useState('')
  const [applied, setApplied] = useState('')
  const [playing, setPlaying] = useState(false)
  const finished = elapsed >= RUN_MS || (ready && version === 1 && elapsed === 0)
  const kind = sourceKind(a)

  useEffect(() => {
    if (elapsed >= RUN_MS && !ready) setReady(true)
  }, [elapsed, ready, setReady])

  const perCol = RUN_MS / Math.max(1, columns.length)
  const doneCols = finished ? columns.length : Math.floor(elapsed / perCol)
  const running = finished ? null : (columns[doneCols] ?? null)
  const short = report.kind === 'sms'
  const durationSec = short ? 48 : 702 + (version - 1) * 18
  const hasFeedback = chips.length > 0 || note.trim().length > 0

  const relaunch = (): void => {
    setApplied([...chips.map((k) => t(k)), note.trim()].filter(Boolean).join(' · '))
    setVersion((v) => v + 1)
    setChips([])
    setNote('')
    setReady(false)
    restart()
  }

  return (
    <div>
      <Question title={t('onb.test.title')} hint={t(`onb.test.intro.${kind === 'own' ? 'own' : kind === 'translate' ? 'translate' : 'new'}`)} />

      <div className="rounded-[16px] border border-line-2 bg-surface-1 p-5" data-testid="test-run" data-state={finished ? 'done' : 'running'}>
        <div className={cn('flex items-center justify-between gap-3', finished ? '' : 'mb-4')}>
          <p className="flex items-center gap-2 text-[14px] font-medium text-fg">
            {finished ? <Check className="size-4 text-ok" aria-hidden /> : <Loader2 className="size-4 animate-spin text-fg-3" aria-hidden />}
            {finished ? t('onb.test.done') : t('onb.test.running', { n: Math.min(columns.length, doneCols + 1), total: columns.length })}
          </p>
          {!finished && (
            <button
              type="button"
              data-testid="onboarding-skip-test"
              onClick={() => skip()}
              className="rounded-full px-2.5 py-1 text-[12.5px] font-medium text-fg-2 outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t('onb.test.skip')}
            </button>
          )}
        </div>
        {!finished && (
          <>
            <ol className="flex items-stretch gap-1.5" aria-label={t('onb.report.pipeline')}>
              {columns.map((col, i) => {
                const done = i < doneCols
                const now = i === doneCols
                return (
                  <li key={i} data-state={done ? 'done' : now ? 'running' : 'todo'} className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span aria-hidden className={cn('h-1 rounded-full transition-colors duration-300', done ? 'bg-ink' : now ? 'bg-fg-3' : 'bg-surface-3')} />
                    {col.map((n) => (
                      <span key={n.id} className={cn('flex items-start gap-1 text-[11.5px] leading-[1.25] font-medium transition-colors duration-300', done ? 'text-fg-2' : now ? 'text-fg' : 'text-fg-4')}>
                        {done ? <Check className="mt-px size-3 shrink-0 text-ok" aria-hidden /> : null}
                        <span className="min-w-0">{n.label}</span>
                      </span>
                    ))}
                  </li>
                )
              })}
            </ol>
            <div className="mt-4 min-h-5 text-[12.5px] text-fg-3" data-testid="test-caption">
              {running ? t('onb.test.caption', { what: running.map((n) => n.provider).join(' · ') }) : ''}
            </div>
            <ProgressBar className="mt-2" value={(elapsed / RUN_MS) * 100} />
          </>
        )}
      </div>

      {finished && (
        <div className="onb-rise mt-4 rounded-[16px] border border-line-2 bg-surface-1 p-5" data-testid="test-result">
          <div className="flex flex-wrap gap-5">
            <button
              type="button"
              data-testid="test-watch"
              onClick={() => setPlaying(true)}
              aria-label={t('onb.test.watch')}
              className={cn('group relative block shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', short ? 'w-[132px]' : 'w-[296px]')}
            >
              <Thumb hue={250 + (version - 1) * 25} format={short ? 'short' : 'long'} className="w-full">
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white transition-transform duration-150 group-hover:scale-105">
                    <Play className="size-5 fill-current" aria-hidden />
                  </span>
                </span>
                <span className="num absolute right-1.5 bottom-1.5 rounded-[5px] bg-black/70 px-1.5 py-px text-[11px] font-medium text-white">{fmtDuration(durationSec)}</span>
              </Thumb>
            </button>
            <div className="min-w-[240px] flex-1">
              <p className="text-[12px] text-fg-3">{t('onb.test.version', { n: version })}</p>
              <h2 className="mt-0.5 text-[17px] leading-[1.3] font-semibold tracking-[-0.015em] text-fg" data-testid="test-title">
                {t(titleKeyOf(a))}
              </h2>
              <p className="num mt-1.5 text-[13px] text-fg-3">
                {t('onb.test.meta', { duration: fmtDuration(durationSec), credits: pipeline?.creditsPerVideo ?? 0, minutes: Math.max(1, Math.round((pipeline?.minutesCloud ?? 10) * 0.9)) })}
              </p>
              {applied && (
                <p className="mt-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2" data-testid="test-applied">
                  {t('onb.test.applied', { what: applied })}
                </p>
              )}
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => setPlaying(true)}>
                <Play className="fill-current" aria-hidden />
                {t('onb.test.watch')}
              </Button>
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <p className="mb-2.5 text-[13px] font-medium text-fg">{t('onb.test.feedback')}</p>
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t('onb.test.feedback')}>
              {TEST_FEEDBACK_CHIPS.map((k) => (
                <Chip key={k} on={chips.includes(k)} onClick={() => setChips(chips.includes(k) ? chips.filter((x) => x !== k) : [...chips, k])}>
                  {t(k)}
                </Chip>
              ))}
            </div>
            <Textarea data-testid="test-feedback" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('onb.test.feedback.placeholder')} className="min-h-[72px] rounded-[14px] text-[13.5px]" />
            <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2.5">
              <Button variant="secondary" data-testid="test-relaunch" disabled={!hasFeedback} onClick={relaunch}>
                {t('onb.test.relaunch')}
              </Button>
              <Button data-testid="test-approve" onClick={next}>
                {t('onb.test.approve')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={playing} onOpenChange={setPlaying}>
        <DialogContent closeLabel={t('common.close')} className="w-[min(640px,92vw)]" data-testid="test-player">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-semibold tracking-[-0.015em]">{t(titleKeyOf(a))}</DialogTitle>
            <DialogDescription>{t('onb.test.player.demo')}</DialogDescription>
          </DialogHeader>
          <div className="mx-auto w-full" style={{ maxWidth: short ? 220 : undefined }}>
            <Thumb hue={250 + (version - 1) * 25} format={short ? 'short' : 'long'} className="w-full">
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white">
                  <Play className="size-6 fill-current" aria-hidden />
                </span>
              </span>
            </Thumb>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
