// The demo's visitor is a fictional owner: the demo store's workspace and engine accounts are renamed in this build only
// (the shared demo data in proto/data-core.ts, used by the desktop's presentation mode and the tests, stays as it is).
import { ENGINE_ACCOUNTS, WORKSPACE } from '@/proto/data-core'

export const DEMO_OWNER = 'Camille'

export function applyDemoPersona(): void {
  const owner = WORKSPACE.members[0]?.name
  WORKSPACE.name = 'Studio Démo'
  WORKSPACE.members = WORKSPACE.members.map((m, i) => (i === 0 ? { ...m, name: DEMO_OWNER, initials: 'C' } : m))
  for (const a of ENGINE_ACCOUNTS) if (a.owner === owner) a.owner = DEMO_OWNER
}
