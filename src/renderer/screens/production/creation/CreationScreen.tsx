// « Créer une pipeline » on the cloning engine (moteur-assemblage, decision 0095): the clone flow of chantier E (intake
// conversation → progress for hours → illustrated report) bound to the `clone.*` API, with the clones already started on
// the side (reopened at their stage: a clone keeps working in the background, its screen is read from saved artefacts).
import { Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { IntakeState } from '../../../../shared/clone'
import { tc } from '../../../../shared/fr-clone'
import { ProtoPage } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { call, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { CloneFlow, type CloneEngine } from '../clone/CloneFlow'
import type { CloneFiles } from '../clone/files'
import { CreateDialog } from '../lab/CreateDialog'
import { usePipelineCodes } from '../recettes/dev-flag'
import { t } from '../../../../shared/fr'

/** The same empty draft as the engine's `startIntake` (the conversation itself runs in main). */
export const EMPTY_INTAKE: IntakeState = { draft: { intent: null, references: [], style: undefined, language: null, sourceLanguage: null, testBudgetUsd: null, humanInputs: null, ownChannel: null }, said: [], asked: null }

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function CreationScreen({ onRoute }: ScreenProps) {
  const [others, setOthers] = useState(false)
  const codes = usePipelineCodes()
  const [id, setId] = useState<string | null>(null)
  /** Remounts the flow only when he picks another clone or a new one (a clone the flow just started keeps its flow). */
  const [flow, setFlow] = useState('new-0')
  const current = useRef<string | null>(null)
  /** The clone shown: the ref is set in the handler, before the flow's own effects read it. */
  const pick = (x: string | null): void => { current.current = x; setId(x) }
  const list = useLoader(() => call('clone.list'), 'clones', ['production'])
  const chosen = (list.data ?? []).find((c) => c.id === id) ?? null

  const engine = useMemo<CloneEngine>(() => ({
    startIntake: () => structuredClone(EMPTY_INTAKE),
    intakeTurn: (state, message) => call('clone.intakeTurn', state, message),
    start: async (state) => {
      const r = await call('clone.start', state)
      current.current = r.cloneId
      setId(r.cloneId)
      list.reload()
    },
    progress: () => (current.current ? call('clone.progress', current.current) : null),
    report: () => (current.current ? call('clone.report', current.current) : null),
    resume: async (budgetUsd) => { if (current.current) await (budgetUsd !== undefined ? call('clone.resume', current.current, budgetUsd) : call('clone.resume', current.current)) },
    answer: async (style) => { if (current.current) await call('clone.answer', current.current, style) }
  }), [list])

  const files = useMemo<CloneFiles>(() => ({
    url: async (rel) => {
      const cloneId = current.current
      if (!cloneId) return null
      try {
        const f = await call('clone.file', cloneId, rel)
        if (f.mime.startsWith('video/')) return URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: f.mime }))
        return `data:${f.mime};base64,${base64(f.bytes)}`
      } catch {
        return null
      }
    }
  }), [])

  const initial = chosen === null ? 'intake' : chosen.state.kind === 'done' ? 'report' : 'progress'
  return (
    <ProtoPage
      testId="view-production-creer"
      title={tc('clone.title')}
      subtitle={tc('clone.subtitle')}
      actions={
        <>
          {/* the other ways in (the form, from my channel, a shared code) */}
          <Button variant="secondary" size="sm" onClick={() => setOthers(true)} data-testid="creation-others">{t('creation.others')}</Button>
          {id !== null && <Button size="sm" onClick={() => { pick(null); setFlow(`new-${Date.now()}`) }} data-testid="clone-new"><Plus className="size-3.5" />{tc('clone.new')}</Button>}
        </>
      }
    >
      <CreateDialog open={others} onOpenChange={setOthers} onRoute={onRoute} codes={codes} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="order-2 flex flex-col gap-1 lg:order-1" data-testid="clone-history">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-fg-3">{tc('clone.history')}</div>
          {(list.data ?? []).map((c) => (
            <button key={c.id} type="button" onClick={() => { pick(c.id); setFlow(c.id) }} className={cn('truncate rounded-[10px] px-2.5 py-1.5 text-left text-[12.5px] transition-colors', c.id === id ? 'bg-surface-3 text-fg' : 'text-fg-2 hover:bg-surface-2')} title={c.title}>
              {c.title.replace(/^https?:\/\/(www\.)?/, '')}
            </button>
          ))}
        </aside>
        <div className="order-1 min-w-0 lg:order-2">
          <CloneFlow key={flow} engine={engine} files={files} initial={initial} budgetUsd={chosen?.budgetUsd ?? null} onNew={() => { pick(null); setFlow(`new-${Date.now()}`) }} />
        </div>
      </div>
    </ProtoPage>
  )
}
