// Projects (production-2, decision 0011): one video made from a pinned recipe version, for a channel or none. Only real
// data: the projects of the database, a small form to make one from a recipe, « Lancer la fabrication » (a project needs a
// channel to run; it opens the launch panel with « Moteur réel », production-16) and « Suivre » to the engine's runs.
// Production-lab: Atlas sits beside the page; the Lab's « Nouvelle vidéo » and « Utiliser cette pipeline » open the form
// (on the pipeline chosen).
import { PipelineSettingsSummary } from './PipelineSettingsSummary'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { t, type MessageKey } from '../../../../shared/fr'
import type { ProjectSummary, RecipeSummary } from '../../../../shared/recipes'
import { ProtoPage, SectionHead } from '@/components/proto/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, Select, Textarea } from '@/components/ui/input'
import { isDemoWeb } from '@/lib/demo'
import { toast } from '@/lib/toast'
import { useProto } from '@/proto/store'
import { call, errText, useApi, useLoader } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { WithAtlas } from '../lab/AtlasDock'
import { LaunchProject } from './LaunchProject'
import { ScriptField } from './ScriptField'
import { ClipLibraryField } from './ClipLibraryField'
import { takeNewVideo } from './selection'
import { LoadLine } from './ui'

const dbId = (id: string): number | null => {
  const m = /^db-(\d+)$/.exec(id)
  return m ? Number(m[1]) : null
}

function NewProject({ recipes, onDone, initialRecipe = null }: { recipes: readonly RecipeSummary[]; onDone: () => void; initialRecipe?: number | null }) {
  const state = useProto()
  const channels = state.channels.map((c) => ({ id: dbId(c.id), name: c.name })).filter((c): c is { id: number; name: string } => c.id !== null)
  const usable = recipes.filter((r) => !r.archived)
  const [recipeId, setRecipeId] = useState<number | null>(usable.find((r) => r.id === initialRecipe)?.id ?? usable[0]?.id ?? null)
  const [channelId, setChannelId] = useState<number | null>(channels[0]?.id ?? null)
  const [title, setTitle] = useState('')
  const [idea, setIdea] = useState('')
  // « J'ai mon script » (agents-production): the owner's script instead of an idea, for a pipeline that imports it
  const [mode, setMode] = useState<'idea' | 'script'>('idea')
  const [script, setScript] = useState('')
  // a story pipeline's background clips (clone-reddit-shorts): the channel's library, or a folder for this video
  const [clipsFolder, setClipsFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const storyPipeline = usable.find((r) => r.id === recipeId)?.base?.startsWith('story-short@') === true
  if (usable.length === 0) return <p className="mb-6 text-[12.5px] text-fg-3">{t('projects.noRecipe')}</p>
  const ready = !!title.trim() && (mode === 'script' ? !!script.trim() : !!idea.trim())
  const create = async (): Promise<void> => {
    if (recipeId === null) return
    setBusy(true)
    try {
      const gameplay: Record<string, string> = storyPipeline && clipsFolder.trim() ? { gameplay: clipsFolder.trim() } : {}
      await call(
        'projects.create',
        mode === 'script' ? { recipeId, channelId, title, idea: '', inputs: { script, ...gameplay } } : { recipeId, channelId, title, idea, ...(gameplay.gameplay ? { inputs: gameplay } : {}) }
      )
      toast.success(t('projects.created'))
      onDone()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card mb-6 grid grid-cols-1 gap-3 p-5 md:grid-cols-2" data-testid="new-project">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-recipe">{t('projects.recipe')}</Label>
        <Select id="project-recipe" value={recipeId ?? ''} onChange={(e) => setRecipeId(Number(e.target.value))}>
          {usable.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · v{r.version}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="project-channel">{t('projects.channel')}</Label>
        <Select id="project-channel" value={channelId ?? ''} onChange={(e) => setChannelId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('projects.channel.none')}</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      {recipeId !== null && <PipelineSettingsSummary recipeId={recipeId} />}
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <Label htmlFor="project-title">{t('projects.titleField')}</Label>
        <Input id="project-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex gap-1.5 md:col-span-2" role="radiogroup" aria-label={t('projects.mode')}>
        {(['idea', 'script'] as const).map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            role="radio"
            aria-checked={mode === m}
            variant={mode === m ? 'default' : 'outline'}
            onClick={() => setMode(m)}
            data-testid={`project-mode-${m}`}
          >
            {t(m === 'idea' ? 'projects.mode.idea' : 'projects.mode.script')}
          </Button>
        ))}
      </div>
      {mode === 'idea' ? (
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="project-idea">{t('projects.idea')}</Label>
          <Textarea id="project-idea" rows={3} value={idea} maxLength={2000} placeholder={t('projects.idea.placeholder')} onChange={(e) => setIdea(e.target.value)} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="project-script">{t('projects.script')}</Label>
          <ScriptField id="project-script" value={script} onChange={setScript} />
          <p className="m-0 text-[12px] text-fg-3">{t('projects.script.hint')}</p>
        </div>
      )}
      {storyPipeline && <ClipLibraryField channelId={channelId} folder={clipsFolder} onFolder={setClipsFolder} />}
      <div className="flex justify-end md:col-span-2">
        <Button size="sm" disabled={busy || !ready} onClick={() => void create()} data-testid="project-create">
          {t('projects.create')}
        </Button>
      </div>
    </div>
  )
}

export function ProjectRows({
  projects,
  channelName,
  onRun,
  onOpen,
  onLaunched
}: {
  projects: readonly ProjectSummary[]
  channelName: (id: number) => string | null
  onRun: (id: number) => void
  onOpen: () => void
  /** A launch panel started a run (the list reloads). */
  onLaunched?: () => void
}) {
  const [launching, setLaunching] = useState<number | null>(null)
  return (
    <ul className="flex flex-col divide-y divide-line rounded-[var(--r-card)] border border-line bg-surface">
      {projects.map((p) => (
        <li key={p.id} data-testid={`project-${p.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-fg">{p.title}</div>
            <div className="truncate text-[12px] text-fg-3">
              {t('projects.pinned', { recipe: p.recipeName, n: p.recipeVersion })} · {p.channelId !== null ? (channelName(p.channelId) ?? `#${p.channelId}`) : t('projects.channel.none')}
            </div>
          </div>
          {p.runId === null ? (
            <>
              <Badge variant="outline">{t('projects.notRun')}</Badge>
              <Button size="sm" disabled={p.channelId === null || launching === p.id} onClick={() => setLaunching(p.id)} data-testid={`project-run-${p.id}`}>
                {t('projects.run')}
              </Button>
              {launching === p.id && (
                <LaunchProject
                  project={p}
                  onClose={() => setLaunching(null)}
                  onDone={() => {
                    setLaunching(null)
                    onLaunched?.()
                  }}
                />
              )}
            </>
          ) : (
            <>
              <Badge>{p.runStatus ? t(`runs.status.${p.runStatus}` as MessageKey) : '—'}</Badge>
              {/* an interrupted, failed or cancelled run is relaunched, the same run (never a second one) */}
              {p.runStatus !== null && ['interrupted', 'failed', 'cancelled'].includes(p.runStatus) && (
                <Button size="sm" onClick={() => onRun(p.id)} data-testid={`project-rerun-${p.id}`}>
                  {t('projects.rerun')}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={onOpen}>
                {t('projects.open')}
              </Button>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export function ProjectsScreen({ onRoute }: ScreenProps) {
  const state = useProto()
  const projects = useLoader(() => call('projects.list'), 'projects', ['production'])
  const recipes = useApi('recipes.list', ['production'])
  // the Lab asked for a new video (on a pipeline): the form opens on it
  const [asked] = useState(() => takeNewVideo())
  const [adding, setAdding] = useState(asked !== null)
  // the web demo's store keeps its `ch-*` channels, numbered 1..n by the demo bridge (web/demo/world.ts)
  const channelName = (id: number): string | null =>
    state.channels.find((c) => c.id === `db-${id}`)?.name ?? (isDemoWeb() ? (state.channels[id - 1]?.name ?? null) : null)
  const run = async (id: number): Promise<void> => {
    try {
      await call('projects.run', id)
      toast.success(t('projects.running'))
      projects.reload()
    } catch (e) {
      toast.error(errText(e))
    }
  }
  const list = projects.data ?? []
  return (
    <ProtoPage
      testId="view-production-projects"
      title={t('projects.title')}
      subtitle={t('projects.subtitle')}
      actions={
        <Button size="sm" variant="secondary" onClick={() => setAdding((a) => !a)} data-testid="project-new">
          <Plus />
          {t('projects.new')}
        </Button>
      }
    >
      <WithAtlas>
      {adding && recipes.data && (
        <NewProject
          recipes={recipes.data}
          initialRecipe={asked?.recipeId ?? null}
          onDone={() => {
            setAdding(false)
            projects.reload()
          }}
        />
      )}
      <SectionHead title={t('projects.title')} count={list.length} />
      <LoadLine error={projects.error} loading={projects.data === null && !projects.error} />
      {projects.data && list.length === 0 && <p className="text-[12.5px] text-fg-3">{t('projects.empty')}</p>}
      {list.length > 0 && <ProjectRows projects={list} channelName={channelName} onRun={(id) => void run(id)} onOpen={() => onRoute({ section: 'production', page: 'encours' })} onLaunched={projects.reload} />}
      </WithAtlas>

    </ProtoPage>
  )
}
