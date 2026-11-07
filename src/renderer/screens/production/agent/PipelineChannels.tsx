// The channels a pipeline serves (production-12, R6.15, R6.8): pick them, save, and see what each channel brings to the
// pipeline's inputs (its voice, its style profile), or « à fournir » when it has nothing yet.
import { useCallback, useEffect, useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { AssignView, ChannelInputView } from '../../../../shared/pipeline-agent'
import { SectionHead } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { call, errText } from '@/state/client'
import { Chip } from './parts'

function inputValue(i: ChannelInputView): { text: string; missing: boolean } {
  if (i.source === 'project') return { text: t('pchan.project'), missing: false }
  return i.value ? { text: i.value, missing: false } : { text: t('pchan.missing'), missing: true }
}

export function PipelineChannels({ recipeId, channels }: { recipeId: number; channels: readonly { id: number; name: string }[] }) {
  const [view, setView] = useState<AssignView | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    call('pipelineAgent.assignment', recipeId).then(
      (v) => {
        setView(v)
        setPicked(v.channels.map((c) => c.channelId))
      },
      (e: unknown) => toast.error(errText(e))
    )
  }, [recipeId])
  useEffect(load, [load])
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const v = await call('pipelineAgent.assign', recipeId, picked)
      setView(v)
      toast.success(t('pchan.saved'))
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const label = (input: string): string => (t(`pchan.input.${input}` as MessageKey) === `pchan.input.${input}` ? input : t(`pchan.input.${input}` as MessageKey))
  return (
    <section className="mb-8" data-testid="pipeline-channels">
      <SectionHead title={t('pchan.title')} />
      <p className="mb-3 text-[12px] text-fg-3">{t('pchan.hint')}</p>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {channels.map((c) => (
          <Chip key={c.id} on={picked.includes(c.id)} onClick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} testId={`pchan-${c.id}`}>
            {c.name}
          </Chip>
        ))}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save()} data-testid="pchan-save">
          {t('pchan.save')}
        </Button>
      </div>
      {view && view.channels.length === 0 && <p className="text-[12px] text-fg-4">{t('pchan.none')}</p>}
      <div className="flex flex-col gap-2">
        {view?.channels.map((c) => (
          <div key={c.channelId} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px]" data-testid={`pchan-inputs-${c.channelId}`}>
            <span className="min-w-[140px] font-medium text-fg">{c.name}</span>
            {c.inputs.map((i) => {
              const v = inputValue(i)
              return (
                <span key={i.input} className="text-fg-3">
                  {label(i.input)} : <span className={v.missing ? 'text-warn' : 'text-fg'}>{v.text}</span>
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
