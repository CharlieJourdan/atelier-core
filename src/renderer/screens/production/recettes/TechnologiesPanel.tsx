// The technologies panel (production-2, decision 0010): every technology of the code registry, by stage, with its status,
// who may use it, the engine nodes it runs, the Atelier Cloud usages it spends, the agent tools it exposes and its
// settings (default, and whether a recipe or a channel may set it). Read-only: a technology is code. In real mode the
// team's voices and the channels' custom bricks (content of the motion technology) follow.
import { t, type MessageKey } from '../../../../shared/fr'
import { RECIPE_STAGES, type TechField, type TechnologyInfo } from '../../../../shared/recipes'
import { ProtoPage, SectionHead } from '@/components/proto/kit'
import { Badge } from '@/components/ui/badge'
import { useProto } from '@/proto/store'
import { useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { CustomBricks } from '../proto/CustomBricks'
import { settingLabel } from './BrickSettings'
import { MyVoices } from './MyVoices'
import { fieldText } from './recipe-model'
import { LoadLine, StageMark, stageLabel, TechStatus, techBlurb, techLabel } from './ui'

/** A default as the panel says it (booleans in words). */
function defaultText(v: unknown): string {
  if (typeof v === 'boolean') return t(v ? 'techPanel.yes' : 'techPanel.no')
  return fieldText(v).replace(/\n/g, ', ') || '—'
}

function FieldLine({ f }: { f: TechField }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
      <span className="text-fg-2">{settingLabel(f.key)}</span>
      <span className="num text-fg-4">{f.default !== undefined ? t('techPanel.default', { value: defaultText(f.default) }) : t('techPanel.unset')}</span>
      {f.recipe && <span className="text-fg-3">· {t('techPanel.byRecipe')}</span>}
      {f.channel && <span className="text-fg-3">· {t('techPanel.byChannel')}</span>}
    </li>
  )
}

export function TechCard({ tech }: { tech: TechnologyInfo }) {
  return (
    <article data-testid={`tech-${tech.name}`} data-status={tech.status} className="card flex flex-col gap-2.5 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{techLabel(tech)}</h3>
          <div className="num text-[11.5px] text-fg-4">{tech.id}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <TechStatus tech={tech} />
          <Badge variant="outline">{t(`tech.access.${tech.access}` as MessageKey)}</Badge>
        </div>
      </div>
      <p className="text-[12.5px] leading-[1.45] text-fg-3">{techBlurb(tech)}</p>
      {tech.superseded && <p className="text-[12px] text-warn">{t('techPanel.superseded')}</p>}
      <dl className="flex flex-col gap-0.5 text-[12px] text-fg-3">
        <dd>{t('techPanel.nodes', { list: tech.nodeTypes.join(', ') })}</dd>
        <dd>{tech.cloudUsages.length > 0 ? t('techPanel.cloud', { list: tech.cloudUsages.join(', ') }) : t('techPanel.cloud.none')}</dd>
        {tech.agentTools.length > 0 && <dd>{t('techPanel.tools', { list: tech.agentTools.join(', ') })}</dd>}
      </dl>
      <div className="border-t border-line pt-2.5">
        <div className="mb-1 text-[11.5px] font-medium tracking-[0.02em] text-fg-3 uppercase">{t('techPanel.settings')}</div>
        {tech.fields.length === 0 ? (
          <p className="text-[12px] text-fg-4">{t('techPanel.settings.none')}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {tech.fields.map((f) => (
              <FieldLine key={f.key} f={f} />
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}

/** The registry by stage (the stage's number, its name, its technologies). */
export function TechnologiesByStage({ techs }: { techs: readonly TechnologyInfo[] }) {
  return (
    <div className="flex flex-col gap-8">
      {RECIPE_STAGES.map((stage) => {
        const list = techs.filter((x) => x.stage === stage)
        return (
          <section key={stage} data-testid={`tech-stage-${stage}`}>
            <div className="mb-3 flex items-center gap-3">
              <StageMark stage={stage} />
              <SectionHead title={stageLabel(stage)} count={list.length} className="mb-0" />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((x) => (
                <TechCard key={x.id} tech={x} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function TechnologiesPanel(_props: ScreenProps) {
  const state = useProto()
  const techs = useApi('technologies.list')
  const list = techs.data ?? []
  return (
    <ProtoPage testId="view-production-technologies" wide title={t('techPanel.title')} subtitle={t('techPanel.subtitle', { n: list.length })}>
      <LoadLine error={techs.error} loading={techs.data === null && !techs.error} />
      <TechnologiesByStage techs={list} />
      {state.mode === 'live' && (
        <div className="mt-10">
          <MyVoices />
          <CustomBricks />
        </div>
      )}
    </ProtoPage>
  )
}
