// The team's voices (real mode only): the voices Atelier Cloud offers (platform voices, the ones cloned by the team), or
// the reason there are none; « Ajouter une voix » clones a recording. Moved from the old Briques screen, without its
// invented demo voices (production-2: Production shows no invented data).
import { Mic, Plus } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import { SectionHead } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { voicesNotice, voicesOf } from '@/proto/live/mapping-voices'
import { channelOf, useProto } from '@/proto/store'
import { VoiceClone } from '../proto/VoiceClone'

export function MyVoices() {
  const state = useProto()
  const list = voicesOf(state)
  const notice = voicesNotice(list.status)
  const [adding, setAdding] = useState(false)
  return (
    <section className="mb-9" data-testid="my-voices">
      <SectionHead
        title={t('prod.res.voices')}
        count={list.voices.length}
        action={
          <Button variant="secondary" size="sm" data-testid="add-voice" disabled={list.status !== 'ok'} onClick={() => setAdding((a) => !a)}>
            <Plus />
            {t('prod.res.addVoice')}
          </Button>
        }
      />
      {adding && list.status === 'ok' && <VoiceClone clone={list.clone} onDone={() => setAdding(false)} />}
      {notice && (
        <p data-testid="voices-notice" className="mb-3 text-[12.5px] leading-[1.5] text-fg-3">
          {t(notice)}
        </p>
      )}
      {list.status === 'ok' && list.voices.length === 0 && <p className="mb-3 text-[12.5px] text-fg-3">{t('prod.res.voices.empty')}</p>}
      {list.status === 'ok' && list.voices.some((v) => v.demo) && <p className="mb-3 text-[12.5px] leading-[1.5] text-fg-3">{t('prod.res.voices.demoNote')}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.voices.map((v) => {
          const ch = channelOf(state, v.channelId ?? null)
          return (
            <div key={v.id} data-testid={`voice-${v.id}`} data-kind={v.kind} className="card flex items-center gap-3 px-3.5 py-3">
              <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-3 ring-1 ring-line">
                <Mic className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-fg">{v.name}</div>
                <div className="truncate text-[12px] text-fg-3">
                  {v.lang} · {t(`prod.res.voiceKind.${v.kind}` as MessageKey)}
                  {v.demo ? ` · ${t('prod.new.voiceDemo')}` : ''}
                  {ch ? ` · ${ch.name}` : ''}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
