// Every role's character at three sizes (Réglages › Galerie, and the proof screenshots of decision 0057), then every
// accessory on its own. The theme is the page's: the same block is looked at in dark and in light.
import { t, type MessageKey } from '../../../shared/fr'
import { ACCESSORY_IDS } from '../../../shared/mascot'
import type { AgentRole } from '@/proto/types'
import { Mascot } from './Mascot'
import { ROLE_LOOK } from './roles'

export const GALLERY_SIZES = [20, 48, 112] as const

export function MascotGallery() {
  const roles = Object.keys(ROLE_LOOK) as AgentRole[]
  return (
    <div data-testid="gallery-mascots">
      <p className="mb-4 max-w-[640px] text-[13px] text-fg-3">{t('gallery.mascots.blurb')}</p>
      <ul className="grid max-w-[1100px] grid-cols-2 gap-3 xl:grid-cols-3">
        {roles.map((role, i) => (
          <li key={role} data-testid={`mascot-role-${role}`} className="flex flex-col gap-3 rounded-[14px] border border-line-2 bg-surface-1 p-3.5">
            <div className="flex items-end gap-3">
              {GALLERY_SIZES.map((size) => (
                <Mascot key={size} role={role} colorIndex={i} size={size} />
              ))}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-fg">{t(`role.${role}` as MessageKey)}</p>
              <p className="truncate text-[12px] text-fg-3">{t(`mascot.acc.${ROLE_LOOK[role].accessory}` as MessageKey)}</p>
            </div>
          </li>
        ))}
      </ul>
      <ul className="mt-5 flex max-w-[1100px] flex-wrap gap-3" data-testid="mascot-accessories">
        {ACCESSORY_IDS.map((id) => (
          <li key={id} className="flex w-[84px] flex-col items-center gap-1 rounded-[12px] border border-line bg-surface-1 px-2 py-2.5">
            <Mascot role="custom" look={{ accessory: id }} colorIndex={7} size={56} />
            <span className="text-[11.5px] text-fg-3">{t(`mascot.acc.${id}` as MessageKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
