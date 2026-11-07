// Shared bits of the Mes outils screens: labels of kinds, statuses and permissions, and the status chip.
import { t, type MessageKey } from '../../../shared/fr'
import type { PermissionRequest, ToolKind, ToolStatus } from '../../../shared/tools'
import { StatusDot, type Tone } from '@/components/atelier/primitives'

export const kindLabel = (k: ToolKind): string => t(`tools.kind.${k}` as MessageKey)
export const statusLabel = (s: ToolStatus): string => t(`tools.status.${s}` as MessageKey)

const TONE: Record<ToolStatus, Tone> = { ok: 'ok', error: 'err', disabled: 'off' }

export function StatusChip({ status }: { status: ToolStatus }) {
  return (
    <span data-testid="tool-status" data-status={status} className="inline-flex items-center gap-1.5 text-[12px] text-fg-2">
      <StatusDot tone={TONE[status]} />
      {statusLabel(status)}
    </span>
  )
}

/** « Lancer le programme python », « Lire $INPUT_FILES »… */
export function permissionLabel(p: Pick<PermissionRequest, 'kind' | 'value'>): string {
  return t(`tools.perm.${p.kind}` as MessageKey, { value: p.value })
}

/** Pretty JSON for display (never throws). */
export function jsonText(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
