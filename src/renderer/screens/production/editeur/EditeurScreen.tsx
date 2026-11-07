// Production › Éditeur: the timeline of a run's edit plan, read from the real outputs of its nodes (director's plan,
// voice, stills, captions, music). Editing operations are not part of this lot, so no editing control is shown.
import { useState } from 'react'
import { t } from '../../../../shared/fr'
import type { RunDetail, RunFileRef, RunOutput, RunSummary } from '../../../../shared/runs'
import { ErrorLine, LoadingBlock } from '@/components/atelier/kit'
import { PageShell } from '@/components/atelier/page'
import { EmptyState } from '@/components/atelier/primitives'
import { Select } from '@/components/ui/input'
import { call, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { RUN_TOPICS } from '../shared'
import { Timeline } from './Timeline'
import { useVoice } from './useVoice'

type Kind<K extends RunOutput['kind']> = Extract<RunOutput, { kind: K }>

interface EditorData {
  plan: Kind<'editplan'> | null
  audio: Kind<'audio'> | null
  images: Kind<'images'> | null
  captions: Kind<'captions'> | null
  music: Kind<'music'> | null
}

const READY = ['done', 'cached', 'waiting_gate']
const nodeOf = (run: RunDetail, family: string): RunDetail['nodes'][number] | undefined =>
  run.nodes.find((n) => n.type.startsWith(`${family}@`) && READY.includes(n.state))

async function loadEditor(runId: number): Promise<EditorData> {
  const run = await call('production.get', runId)
  const get = async <K extends RunOutput['kind']>(family: string, kind: K): Promise<Kind<K> | null> => {
    const n = nodeOf(run, family)
    if (!n) return null
    const out = await call('production.output', runId, n.nodeId)
    return out.kind === kind ? (out as Kind<K>) : null
  }
  const [plan, audio, images, captions, music] = await Promise.all([
    get('director.plan', 'editplan'),
    get('voice.tts', 'audio').then((a) => a ?? get('voice.own', 'audio')),
    get('visuals.fulfil', 'images'),
    get('captions.make', 'captions'),
    get('sound.music', 'music')
  ])
  return { plan, audio, images, captions, music }
}

function EditorBody({ runId, data }: { runId: number; data: EditorData }) {
  const plan = data.plan
  const duration = plan?.durationS ?? 0
  const voice = useVoice(runId, data.audio?.file.ref ?? null, data.audio?.words ?? [], data.audio?.durationS ?? duration)
  if (!plan || duration <= 0) return <EmptyState title={t('production.editor.noPlan.title')} blurb={t('production.editor.noPlan.blurb')} />
  const stills = new Map<string, RunFileRef>((data.images?.images ?? []).map((i) => [i.itemId, i.file]))
  return (
    <Timeline
      runId={runId}
      plan={plan}
      voice={voice}
      voiceDurationS={data.audio?.durationS ?? null}
      stills={stills}
      captions={data.captions ? { preset: data.captions.preset ?? plan.captionsPreset, cues: data.captions.cues, burn: data.captions.burn } : null}
      music={data.music ? { durationS: data.music.durationS } : null}
    />
  )
}

export function EditeurScreen(_props: ScreenProps) {
  const runs = useLoader(() => call('production.list', { status: ['succeeded', 'waiting', 'running'], limit: 100 }), 'editor-runs', RUN_TOPICS)
  const [picked, setPicked] = useState<number | null>(null)
  const list: RunSummary[] = runs.data ?? []
  const current = list.find((r) => r.id === picked) ?? list[0] ?? null
  const editor = useLoader(() => (current ? loadEditor(current.id) : Promise.resolve(null)), String(current?.id ?? 0), [])

  return (
    <PageShell
      section="production"
      title={t('page.production.editeur')}
      subtitle={t('production.editor.subtitle')}
      actions={
        list.length > 0 ? (
          <Select aria-label={t('production.editor.pick')} value={current?.id ?? ''} onChange={(e) => setPicked(Number(e.target.value))} className="w-72">
            {list.map((r) => (
              <option key={r.id} value={r.id}>
                {r.videoTitle} — {t(`runs.status.${r.status}` as never)}
              </option>
            ))}
          </Select>
        ) : undefined
      }
    >
      {runs.error && <ErrorLine message={runs.error} onRetry={runs.reload} />}
      {!runs.data && !runs.error && <LoadingBlock rows={4} />}
      {runs.data && list.length === 0 && <EmptyState title={t('production.editor.empty.title')} blurb={t('production.editor.empty.blurb')} />}
      {current && (
        <>
          {editor.error && <ErrorLine message={editor.error} onRetry={editor.reload} />}
          {!editor.data && !editor.error && <LoadingBlock rows={5} />}
          {editor.data && <EditorBody key={current.id} runId={current.id} data={editor.data} />}
        </>
      )}
    </PageShell>
  )
}
