// « Recruter un agent »: pick a template (or a custom agent), name it, give it a channel and a manager, a model tier and
// instructions. The new agent joins the shared proto store (`addAgent`) and shows up in the chart with a « Nouveau » tag.
import { useMemo, useState } from 'react'
import { t, type MessageKey } from '../../../shared/fr'
import { Segmented } from '@/components/proto/kit'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { EFFORTS, EFFORT_MODEL, RECRUIT_TEMPLATES, effortOf, type Effort, type RecruitTemplate } from '@/proto/data-team-agents'
import { blueprintRecruits } from '@/proto/live/mapping-blueprint'
import { useProto, useProtoActions } from '@/proto/store'
import type { ProtoChannel } from '@/proto/types'
import { leadOf, type TeamAgent } from './model'
import { teamActions } from './store'

const SUGGESTED_NAMES = ['Mina', 'Sam', 'Lina', 'Théo', 'Nora', 'Léo']
const ALL = '__all__'

function tplName(id: string): string {
  return t(`team.recruit.tpl.${id}.name` as MessageKey)
}

/** A template of the published blueprint, shown after Atelier's own: its name is the founder's, not a catalogue key. */
const BP_PREFIX = 'bp:'

export function RecruitDialog({
  open,
  onOpenChange,
  channels,
  agents,
  defaultChannelId,
  principalId,
  onRecruited
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  channels: readonly ProtoChannel[]
  agents: readonly TeamAgent[]
  defaultChannelId: string | null
  principalId: string
  onRecruited: (id: string) => void
}) {
  const { addAgent } = useProtoActions()
  const { liveBlueprint, mode } = useProto()
  const custom = RECRUIT_TEMPLATES.find((x) => x.id === 'custom') ?? (RECRUIT_TEMPLATES[0] as RecruitTemplate)
  // real mode: the blueprint's agents the runtime has no role for, offered as templates (the same fields, a « custom » role)
  const fromBlueprint = useMemo(
    () => (mode === 'live' ? blueprintRecruits(liveBlueprint).map((b): RecruitTemplate & { title: string } => ({ id: `${BP_PREFIX}${b.id}`, title: b.name, role: 'custom', model: b.model, instructions: b.instructions, budget: custom.budget })) : []),
    [mode, liveBlueprint, custom.budget]
  )
  const [tplId, setTplId] = useState<string>(RECRUIT_TEMPLATES[0]?.id ?? 'community')
  const tpl: RecruitTemplate = RECRUIT_TEMPLATES.find((x) => x.id === tplId) ?? fromBlueprint.find((x) => x.id === tplId) ?? (RECRUIT_TEMPLATES[0] as RecruitTemplate)
  const tplTitle = (x: RecruitTemplate): string => (x.id.startsWith(BP_PREFIX) ? (fromBlueprint.find((b) => b.id === x.id)?.title ?? x.id) : tplName(x.id))
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState<string>(defaultChannelId ?? channels[0]?.id ?? ALL)
  const [parentId, setParentId] = useState<string | null>(null)
  const [effort, setEffort] = useState<Effort>(effortOf(tpl.model))
  const [instructions, setInstructions] = useState(tpl.instructions)

  const suggested = SUGGESTED_NAMES[agents.length % SUGGESTED_NAMES.length] ?? 'Mina'
  const managerOptions = useMemo(
    () => [
      { id: principalId, label: agents.find((a) => a.id === principalId)?.name ?? '' },
      ...channels.flatMap((c) => {
        const lead = leadOf(agents, c.id)
        return lead ? [{ id: lead.id, label: `${lead.name} · ${c.name}` }] : []
      })
    ],
    [agents, channels, principalId]
  )
  const defaultParent = channelId === ALL ? principalId : (leadOf(agents, channelId)?.id ?? principalId)
  const effectiveParent = parentId ?? defaultParent

  function pick(next: RecruitTemplate) {
    setTplId(next.id)
    setEffort(effortOf(next.model))
    setInstructions(next.instructions)
  }

  function submit() {
    const finalName = name.trim() || suggested
    const id = addAgent({
      name: finalName,
      role: tpl.role,
      channelId: channelId === ALL ? null : channelId,
      parentId: effectiveParent,
      status: 'idle',
      task: t('team.recruit.firstTask'),
      model: EFFORT_MODEL[effort],
      load: 0,
      memoryItems: 0,
      tasksDone7d: 0,
      colorIndex: (agents.length + 3) % 8
    }, instructions)
    teamActions.markRecruited(id, tplTitle(tpl))
    teamActions.editAgent(id, { instructions, budget: tpl.budget })
    toast.success(t('team.recruit.done', { name: finalName }))
    setName('')
    setParentId(null)
    onOpenChange(false)
    onRecruited(id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="agents-recruit-dialog" className="w-[min(780px,94vw)] gap-0 p-0" closeLabel={t('common.close')}>
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-[20px] font-semibold tracking-[-0.02em]">{t('team.recruit.title')}</DialogTitle>
          <DialogDescription>{t('team.recruit.blurb')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 border-t border-line md:grid-cols-[250px_1fr]">
          <ul className="flex max-h-[480px] flex-col gap-0.5 overflow-y-auto border-b border-line p-2.5 md:border-r md:border-b-0" role="radiogroup" aria-label={t('team.recruit.templates')}>
            {RECRUIT_TEMPLATES.map((x) => {
              const on = x.id === tplId
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`recruit-tpl-${x.id}`}
                    onClick={() => pick(x)}
                    className={cn('w-full rounded-[10px] px-3 py-2 text-left transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring', on ? 'bg-selected' : 'hover:bg-hover')}
                  >
                    <span className="block text-[13px] font-medium text-fg">{tplName(x.id)}</span>
                    <span className="mt-0.5 block text-[12px] leading-[1.4] text-fg-3">{t(`team.recruit.tpl.${x.id}.blurb` as MessageKey)}</span>
                  </button>
                </li>
              )
            })}
            {fromBlueprint.length > 0 && (
              <li className="mt-2 px-3 pb-0.5 text-[11.5px] font-medium text-fg-3" data-testid="recruit-blueprint-heading">
                {t('team.recruit.blueprint')}
              </li>
            )}
            {fromBlueprint.map((x) => {
              const on = x.id === tplId
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`recruit-tpl-${x.id}`}
                    onClick={() => pick(x)}
                    className={cn('w-full rounded-[10px] px-3 py-2 text-left transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring', on ? 'bg-selected' : 'hover:bg-hover')}
                  >
                    <span className="block text-[13px] font-medium text-fg">{x.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-[1.4] text-fg-3">{t('team.recruit.blueprintBlurb')}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="flex max-h-[480px] flex-col gap-4 overflow-y-auto p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recruit-name">{t('team.recruit.name')}</Label>
                <Input id="recruit-name" data-testid="recruit-name" value={name} placeholder={suggested} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recruit-channel">{t('team.recruit.channel')}</Label>
                <Select
                  id="recruit-channel"
                  value={channelId}
                  onChange={(e) => {
                    setChannelId(e.target.value)
                    setParentId(null)
                  }}
                >
                  <option value={ALL}>{t('team.recruit.allTeam')}</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="recruit-parent">{t('team.recruit.reportsTo')}</Label>
              <Select id="recruit-parent" value={effectiveParent} onChange={(e) => setParentId(e.target.value)}>
                {managerOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('team.recruit.effort')}</Label>
              <Segmented size="sm" value={effort} options={EFFORTS.map((e) => ({ value: e, label: t(`team.effort.${e}` as MessageKey) }))} onChange={setEffort} className="w-full [&>button]:flex-1" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="recruit-instructions">{t('team.sheet.instructions')}</Label>
              <Textarea id="recruit-instructions" data-testid="recruit-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} className="min-h-[120px] text-[13px] leading-[1.5]" />
            </div>
          </div>
        </div>
        <DialogFooter className="justify-end border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="recruit-submit" onClick={submit}>
            {t('team.recruit.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
