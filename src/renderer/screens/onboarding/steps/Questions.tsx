// Step 6: every question at once, grouped on one scrollable screen. Who does what, rhythm, voice, art direction, human
// inputs, products and sponsors, where the finished videos go and how they are published.
import { AudioLines, FileAudio, Library, Mic2, Play } from 'lucide-react'
import { t } from '../../../../shared/fr'
import { Segmented } from '@/components/proto/kit'
import { Select, Switch } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AUTOMATION_PRESETS, DETECTED_PRODUCTS, MINIMAX_VOICES } from '@/proto/data-onboarding'
import { isHardToReplicate, sourceKind, type ArtChoice, type ProductRow, type PublishChoice, type StepProps, type StorageChoice, type VoiceChoice } from '../model'
import { AutomationMatrix, ChoiceCard, Chip, Group, Inset, ProductsEditor, Question, Row, Stepper } from '../parts'

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const
const HOURS = Array.from({ length: 17 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`)

const VOICES: { id: VoiceChoice; icon: typeof Mic2 }[] = [
  { id: 'clone', icon: AudioLines },
  { id: 'library', icon: Library },
  { id: 'elevenlabs', icon: FileAudio },
  { id: 'own', icon: Mic2 }
]

function sameLevels(a: Record<string, string>, b: Record<string, string>): boolean {
  return Object.keys(a).every((k) => a[k] === b[k])
}

export function QuestionsStep({ a, set }: StepProps) {
  const kind = sourceKind(a)
  const existing = kind === 'own' || kind === 'translate'
  const cloneKey = existing ? 'own' : 'new'
  const detected = kind === 'own' && !isHardToReplicate(a) ? DETECTED_PRODUCTS : []
  return (
    <div data-testid="onboarding-questions">
      <Question title={t('onb.q.title')} hint={t('onb.q.hint')} />

      <Group title={t('onb.q.who')} hint={t('onb.q.who.hint')} testId="q-who">
        <div className="mb-3 flex flex-wrap gap-2">
          {AUTOMATION_PRESETS.map((p) => (
            <Chip key={p.id} testId={`preset-${p.id}`} on={sameLevels({ ...a.automation }, { ...p.levels })} onClick={() => set({ automation: { ...p.levels } })}>
              {t(p.labelKey)}
            </Chip>
          ))}
        </div>
        <AutomationMatrix value={a.automation} onChange={(automation) => set({ automation })} />
      </Group>

      <Group title={t('onb.q.rhythm')} hint={t('onb.q.rhythm.hint')} testId="q-rhythm">
        <Inset>
          <Row label={t('onb.q.rhythm.videos')} hint={t('onb.q.rhythm.videos.hint')}>
            <Stepper value={a.videosPerWeek} min={0} max={14} label={t('onb.q.rhythm.videos')} testId="stepper-videos" onChange={(videosPerWeek) => set({ videosPerWeek })} />
          </Row>
          <Row label={t('onb.q.rhythm.shorts')} hint={t('onb.q.rhythm.shorts.hint')}>
            <Stepper value={a.shortsPerDay} min={0} max={10} label={t('onb.q.rhythm.shorts')} testId="stepper-shorts" onChange={(shortsPerDay) => set({ shortsPerDay })} />
          </Row>
          <Row label={t('onb.q.rhythm.days')}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('onb.q.rhythm.days')}>
              {DAYS.map((d) => (
                <Chip
                  key={d}
                  on={a.days.includes(d)}
                  onClick={() => set({ days: a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d].sort() })}
                  className="h-8 min-w-10 px-2.5"
                >
                  {t(`onb.day.${d}`)}
                </Chip>
              ))}
            </div>
          </Row>
          <Row label={t('onb.q.rhythm.hour')} hint={t('onb.q.rhythm.hour.hint')}>
            <Select aria-label={t('onb.q.rhythm.hour')} value={a.hour} onChange={(e) => set({ hour: e.target.value })} className="h-9 w-[110px] rounded-full">
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </Row>
        </Inset>
      </Group>

      <Group title={t('onb.q.voice')} hint={t('onb.q.voice.hint')} testId="q-voice">
        <div role="radiogroup" aria-label={t('onb.q.voice')} className="grid gap-3 sm:grid-cols-2">
          {VOICES.map(({ id, icon: Icon }) => (
            <ChoiceCard
              key={id}
              testId={`voice-${id}`}
              selected={a.voice === id}
              onSelect={() => set({ voice: id })}
              icon={<Icon className="size-[18px]" aria-hidden />}
              title={t(id === 'clone' ? `onb.voice.clone.${cloneKey}` : `onb.voice.${id}`)}
              description={t(id === 'clone' ? `onb.voice.clone.desc.${cloneKey}` : `onb.voice.${id}.desc`)}
            >
              {id === 'library' && a.voice === 'library' && (
                <div className="mx-4 flex flex-wrap gap-1.5 border-t border-line pt-3 pb-3.5" role="radiogroup" aria-label={t('onb.voice.library')}>
                  {MINIMAX_VOICES.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={a.voiceSample === v.id}
                      data-testid={`voice-sample-${v.id}`}
                      onClick={() => set({ voiceSample: v.id })}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-ring',
                        a.voiceSample === v.id ? 'border-ink bg-ink text-ink-fg' : 'border-line-2 text-fg-2 hover:bg-hover'
                      )}
                    >
                      <Play className="size-3 fill-current" aria-hidden />
                      {t(v.labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </ChoiceCard>
          ))}
        </div>
      </Group>

      {!existing || kind === 'translate' ? (
        <Group title={t('onb.q.art')} hint={t(kind === 'translate' ? 'onb.q.art.hint.translate' : 'onb.q.art.hint')} testId="q-art">
          <div role="radiogroup" aria-label={t('onb.q.art')} className="grid gap-3 sm:grid-cols-3">
            {(['keep', 'mix', 'new'] as ArtChoice[]).map((id) => (
              <ChoiceCard key={id} testId={`art-${id}`} selected={a.art === id} onSelect={() => set({ art: id })} title={t(`onb.art.${id}`)} description={t(`onb.art.${id}.desc`)} />
            ))}
          </div>
        </Group>
      ) : null}

      <Group title={t('onb.q.human')} hint={t('onb.q.human.hint')} testId="q-human">
        <Inset>
          <Row label={t('onb.q.human.scripts')} hint={t('onb.q.human.scripts.hint')}>
            <Switch
              aria-label={t('onb.q.human.scripts')}
              data-testid="human-scripts"
              checked={a.automation.script === 'human'}
              onCheckedChange={(on) => set({ automation: { ...a.automation, script: on ? 'human' : 'validate' } })}
            />
          </Row>
          <Row label={t('onb.q.human.gameplay')} hint={t('onb.q.human.gameplay.hint')}>
            <Switch aria-label={t('onb.q.human.gameplay')} data-testid="human-gameplay" checked={a.gameplay} onCheckedChange={(gameplay) => set({ gameplay })} />
          </Row>
          <Row label={t('onb.q.human.rushes')} hint={t('onb.q.human.rushes.hint')}>
            <Switch aria-label={t('onb.q.human.rushes')} data-testid="human-rushes" checked={a.rushes} onCheckedChange={(rushes) => set({ rushes })} />
          </Row>
        </Inset>
      </Group>

      <Group title={t('onb.q.products')} hint={t('onb.q.products.hint')} testId="q-products">
        <ProductsEditor<ProductRow> items={a.products} onChange={(products) => set({ products })} detected={detected} make={(p) => p} />
      </Group>

      <Group title={t('onb.q.delivery')} testId="q-delivery">
        <Inset>
          <Row label={t('onb.q.storage')} hint={t('onb.q.storage.hint')}>
            <Segmented<StorageChoice>
              size="sm"
              value={a.storage}
              onChange={(storage) => set({ storage })}
              options={[
                { value: 'atelier', label: t('onb.storage.atelier') },
                { value: 'drive', label: t('onb.storage.drive') },
                { value: 'dropbox', label: t('onb.storage.dropbox') }
              ]}
            />
          </Row>
          <Row label={t('onb.q.publishing')} hint={t(a.publishing === 'auto' ? 'onb.q.publishing.auto.hint' : 'onb.q.publishing.manual.hint')}>
            <Segmented<PublishChoice>
              size="sm"
              value={a.publishing}
              onChange={(publishing) => set({ publishing })}
              options={[
                { value: 'auto', label: t('onb.publishing.auto') },
                { value: 'manual', label: t('onb.publishing.manual') }
              ]}
            />
          </Row>
        </Inset>
      </Group>
    </div>
  )
}
