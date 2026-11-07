// « Nouvelle vidéo » shows the pipeline's settings before a project is made (avatar-reglages-voix, Charlie 02/11: the character,
// the voice, the offer, the presenter's shots, layouts and acting, the editing — « montrés simplement dans la page de la
// pipeline et dans Nouvelle vidéo »): one line per group with the chosen value of each option. They are the pipeline's
// settings (record 0055): they change in the pipeline, which every video made with it then follows.
import { t, type MessageKey } from '../../../../shared/fr'
import { OPTION_GROUPS, optionPlace } from '../../../../shared/option-previews'
import { call, useApi, useLoader } from '@/state/client'

const word = (key: string): string => t(key as MessageKey)

export function PipelineSettingsSummary({ recipeId }: { recipeId: number }) {
  const bases = useApi('recipes.bases', ['production'])
  const recipe = useLoader(() => call('recipes.get', recipeId), `recipe-${recipeId}`, ['production'])
  const doc = recipe.data?.doc
  const base = bases.data?.find((b) => b.id === doc?.base)
  if (!doc || !base) return null
  const rows = OPTION_GROUPS.map((g) => {
    const values = g.options.flatMap((id) => {
      const o = base.options.find((x) => x.id === id && optionPlace(x.id) === 'main')
      if (!o || o.kind === 'slider') return []
      const v = doc.options[o.id] ?? o.default
      const c = o.choices.find((x) => x.value === v)
      return c ? [`${word(o.labelKey)} : ${word(c.labelKey).toLowerCase()}`] : []
    })
    return { id: g.id, values }
  }).filter((r) => r.values.length > 0)
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surface-2 p-3 md:col-span-2" data-testid="pipe-settings-summary">
      <span className="text-[12px] font-semibold text-fg-2">{t('pipe.settings')}</span>
      {rows.map((r) => (
        <p key={r.id} className="text-[12px] text-fg-3" data-testid={`pipe-settings-${r.id}`}>
          <span className="font-medium text-fg-2">{word(`pipe.group.${r.id}`)}</span> — {r.values.join(' · ')}
        </p>
      ))}
      <span className="text-[11px] text-fg-4">{t('pipe.settings.change')}</span>
    </div>
  )
}
