// The light customisation of a mascot, on the agent's sheet in Équipe: one of the 8 body colours and one held accessory from
// a short list (the role's own first). Nothing else changes: the hat and the face belong to the role, so « who is who »
// stays readable (decision 0057). `onChange(null)` goes back to the role's defaults.
import { t, type MessageKey } from '../../../shared/fr'
import { MASCOT_COLOR_COUNT, type AgentLook } from '../../../shared/mascot'
import { agentColors } from '@/components/atelier/primitives'
import { cn } from '@/lib/utils'
import { ROLE_LOOK, accessoryChoices, nextLook, resolveLook, type RoleLook } from './roles'
import { AccessoryIcon } from './accessories'
import { Mascot } from './Mascot'

export function MascotEditor({
  role,
  look,
  colorIndex,
  onChange
}: {
  role: string
  look: AgentLook | null | undefined
  colorIndex: number
  onChange: (look: AgentLook | null) => void
}) {
  const now = resolveLook(role, look, colorIndex)
  const own = ((ROLE_LOOK as Record<string, RoleLook | undefined>)[role] ?? ROLE_LOOK.custom).accessory
  const pick = (patch: AgentLook): void => onChange(nextLook(role, look, colorIndex, patch))
  return (
    <section data-testid="mascot-editor">
      <div className="mb-3 flex items-center gap-3.5">
        <div className="flex size-[72px] shrink-0 items-center justify-center rounded-[16px] border border-line-2 bg-surface-2">
          <Mascot role={role} look={look} colorIndex={colorIndex} size={60} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">{t('mascot.title')}</h3>
          <p className="mt-0.5 text-[12px] text-fg-3">{t('mascot.hint')}</p>
        </div>
      </div>

      <p className="mb-1.5 text-[12px] font-medium text-fg-2">{t('mascot.color')}</p>
      <div role="radiogroup" aria-label={t('mascot.color')} className="mb-3.5 flex flex-wrap gap-2">
        {Array.from({ length: MASCOT_COLOR_COUNT }, (_, i) => {
          const [a, b] = agentColors(i)
          const on = i === now.color
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t('mascot.color.n', { n: i + 1 })}
              data-testid={`mascot-color-${i}`}
              onClick={() => pick({ color: i })}
              className={cn(
                'size-7 rounded-full outline-none ring-offset-2 ring-offset-surface-1 transition-shadow focus-visible:outline-2 focus-visible:outline-ring',
                on ? 'ring-2 ring-fg' : 'ring-1 ring-line-3 hover:ring-fg-3'
              )}
              style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }}
            />
          )
        })}
      </div>

      <p className="mb-1.5 text-[12px] font-medium text-fg-2">{t('mascot.accessory')}</p>
      <div role="radiogroup" aria-label={t('mascot.accessory')} className="grid grid-cols-5 gap-1.5">
        {accessoryChoices(role).map((id) => {
          const on = id === now.accessory
          const label = t(`mascot.acc.${id}` as MessageKey)
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`mascot-accessory-${id}`}
              title={id === own ? `${label} (${t('mascot.default')})` : label}
              onClick={() => pick({ accessory: id })}
              className={cn(
                'flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-[10px] border text-[10.5px] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                on ? 'border-line-3 bg-selected text-fg' : 'border-line-2 bg-surface-2 text-fg-3 hover:bg-hover hover:text-fg'
              )}
            >
              <AccessoryIcon id={id} size={28} />
              <span className="max-w-full truncate px-0.5">{label}</span>
            </button>
          )
        })}
      </div>

      {look && (
        <button type="button" data-testid="mascot-reset" onClick={() => onChange(null)} className="mt-3 text-[12px] text-fg-3 underline decoration-line-3 underline-offset-[3px] outline-none transition-colors hover:text-fg focus-visible:text-fg">
          {t('mascot.reset')}
        </button>
      )}
    </section>
  )
}
