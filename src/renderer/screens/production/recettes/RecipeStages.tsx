// The recipe as a rail of its seven stages (decision 0011): each stage shows its bricks (a technology of the registry and
// its settings), lets one be removed or its settings opened, and offers the technologies the stage may still take. The
// pipeline graph opens a brick's settings through `focus` (production-13).
import { ChevronDown, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../../../shared/fr'
import { RECIPE_STAGES, type RecipeDocument, type RecipeStage, type TechnologyInfo } from '../../../../shared/recipes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { BrickSettings } from './BrickSettings'
import { addable, addBrick, bricksByStage, removeBrick, setSetting } from './recipe-model'
import { StageMark, stageHelp, stageLabel, techBlurb, techLabel } from './ui'

function Brick({
  tech,
  settings,
  focused,
  onRemove,
  onSetting
}: {
  tech: TechnologyInfo
  settings: Record<string, unknown>
  /** Set when the graph asks for this brick: its settings open and it scrolls into view. */
  focused: number | null
  onRemove: () => void
  onSetting: (key: string, value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  // a new ask from the graph opens the settings (adjusted while rendering), lights the brick for a moment and scrolls to it
  const [asked, setAsked] = useState<number | null>(null)
  const [faded, setFaded] = useState<number | null>(null)
  if (focused !== null && focused !== asked) {
    setAsked(focused)
    setOpen(true)
  }
  const lit = focused !== null && faded !== focused
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focused === null) return
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = setTimeout(() => setFaded(focused), 1400)
    return () => clearTimeout(timer)
  }, [focused])
  const set = Object.keys(settings).length
  return (
    <div
      ref={box}
      data-testid={`brick-${tech.name}`}
      className={cn('rounded-[var(--r-field)] border border-line-2 bg-surface transition-shadow duration-[240ms]', lit && 'shadow-[0_0_0_3px_var(--line-3)]')}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-fg">{techLabel(tech)}</span>
            <span className="num text-[11px] text-fg-4">{tech.id}</span>
            {tech.status === 'draft' && <Badge variant="warn">{t('recipeEd.draftTech')}</Badge>}
          </div>
          <p className="mt-0.5 text-[12px] leading-[1.45] text-fg-3">{techBlurb(tech)}</p>
          {tech.inputs.length > 0 && <p className="mt-1 text-[11.5px] text-fg-3">{t('recipeEd.needs', { list: tech.inputs.map((i) => i.label).join(', ') })}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={`brick-settings-${tech.name}`}>
            {t('recipeEd.settings')}
            {set > 0 && <span className="num rounded-full bg-surface-2 px-1.5 text-[10.5px] text-fg-2">{set}</span>}
            <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('recipeEd.remove', { name: techLabel(tech) })} onClick={onRemove}>
            <X />
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t border-line px-3.5 py-3">
          <BrickSettings tech={tech} settings={settings} onChange={onSetting} idPrefix={`set-${tech.name.replace(/\./g, '-')}`} />
        </div>
      )}
    </div>
  )
}

function AddBrick({ stage, options, onAdd }: { stage: RecipeStage; options: TechnologyInfo[]; onAdd: (t: TechnologyInfo) => void }) {
  if (options.length === 0) return null
  return (
    <label className="flex items-center gap-2 text-[12px] text-fg-3">
      <Plus className="size-3.5" aria-hidden />
      <span className="sr-only">{t('recipeEd.add')}</span>
      <Select
        value=""
        data-testid={`add-${stage}`}
        className="h-8 w-auto min-w-[220px] text-[12.5px]"
        onChange={(e) => {
          const tech = options.find((o) => o.id === e.target.value)
          if (tech) onAdd(tech)
        }}
      >
        <option value="">{t('recipeEd.add')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {techLabel(o)}
          </option>
        ))}
      </Select>
    </label>
  )
}

export function RecipeStages({
  doc,
  techs,
  onChange,
  focus = null
}: {
  doc: RecipeDocument
  techs: readonly TechnologyInfo[]
  onChange: (doc: RecipeDocument) => void
  focus?: { brick: string; n: number } | null
}) {
  const byStage = bricksByStage(doc, techs)
  return (
    <ol className="relative flex flex-col" data-testid="recipe-stages">
      {RECIPE_STAGES.map((stage, i) => {
        const bricks = byStage[stage]
        const last = i === RECIPE_STAGES.length - 1
        return (
          <li key={stage} data-testid={`stage-${stage}`} className="relative flex gap-4 pb-6">
            {/* the rail: one line from this stage's mark to the next */}
            {!last && <span aria-hidden className="absolute top-8 bottom-0 left-[13.5px] w-px bg-line-2" />}
            <StageMark stage={stage} filled={bricks.length > 0} className="relative z-[1]" />
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-1">
                <h3 className="text-[14px] font-semibold tracking-[-0.012em] text-fg">{stageLabel(stage)}</h3>
                <p className="text-[12px] text-fg-3">{stageHelp(stage)}</p>
              </div>
              <div className="flex flex-col gap-2">
                {bricks.length === 0 && <p className="text-[12px] text-fg-4">{t('recipeEd.stage.empty')}</p>}
                {bricks.map(({ index, tech }) => (
                  <Brick
                    key={tech.id}
                    tech={tech}
                    settings={doc.bricks[index]?.settings ?? {}}
                    focused={focus?.brick === tech.name ? focus.n : null}
                    onRemove={() => onChange(removeBrick(doc, index))}
                    onSetting={(key, value) => onChange(setSetting(doc, index, key, value))}
                  />
                ))}
                <AddBrick stage={stage} options={addable(doc, stage, techs)} onAdd={(tech) => onChange(addBrick(doc, tech, techs))} />
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
