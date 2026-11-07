// Real mode, the account: what the sidebar, Accueil and Monétisation show about the person comes from Atelier Cloud
// (`cloud.profile`: names, role, plan, credits), never from the demo workspace. Without an account (offline) the workspace
// is empty and says so. Pure (unit-tested).
import type { CloudProfile, CloudStatus } from '../../../shared/api'
import { t, type MessageKey } from '../../../shared/fr'
import type { Workspace } from '../types'
import { OFFLINE_WORKSPACE } from '../store'

/** « Charlie Jourdan » → « CJ », « charlie » → « C ». */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words.slice(0, 1)
  return letters.map((w) => w.charAt(0).toUpperCase()).join('') || '·'
}

const PLANS = ['starter', 'creator', 'studio', 'agency', 'network'] as const

/** The plan's name as the site shows it, or the « no plan » text. */
export function planLabel(plan: string | null): string {
  return plan && (PLANS as readonly string[]).includes(plan) ? t(`beta.plan.${plan}` as MessageKey) : t('beta.plan.none')
}

/** The workspace of real mode: the Cloud account when known, the names kept by the session while the Cloud is unreachable, else offline. */
export function workspaceOf(profile: CloudProfile | null, status: CloudStatus | null): Workspace {
  if (profile) {
    return {
      name: profile.teamName,
      plan: planLabel(profile.plan),
      credits: profile.credits.available,
      creditsMonthly: 0,
      autoTopUp: false,
      seats: 1,
      members: [{ name: profile.name, role: profile.role === 'member' ? 'editor' : profile.role, initials: initialsOf(profile.name) }],
      cloud: 'signed-in',
      email: profile.email
    }
  }
  if (status?.connected) {
    const a = status.account
    return {
      ...OFFLINE_WORKSPACE,
      name: a?.teamName ?? '',
      members: a ? [{ name: a.name, role: 'owner', initials: initialsOf(a.name) }] : [],
      cloud: 'signed-in',
      ...(a ? { email: a.email } : {})
    }
  }
  return OFFLINE_WORKSPACE
}
