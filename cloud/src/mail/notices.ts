// Billing and team-computer e-mails: who is told (the team's owners and admins, each in their own language) and what.
// Every message carries a dedupe key made of the event and the recipient, so a replayed payment event or a second
// provisioning pass never mails twice.
import type { Accounts } from '../accounts.ts'
import { PLANS } from '../billing/catalog.ts'
import type { BillingNotice } from '../billing/service.ts'
import type { PlanId } from '../machines/plans.ts'
import type { MailService } from './service.ts'
import type { Template } from './templates.ts'

export class TeamNotices {
  private readonly accounts: Accounts
  private readonly mail: MailService
  constructor(accounts: Accounts, mail: MailService) {
    this.accounts = accounts
    this.mail = mail
  }

  /** A payment event or a top-up result (called after the transaction that applied it committed). */
  billing(n: BillingNotice): void {
    const planName = (id: PlanId | undefined): string => (id ? PLANS[id].name : '')
    this.toTeam(n.teamId, n.key, (name) => {
      switch (n.type) {
        case 'receipt':
          return {
            kind: 'receipt',
            name,
            item: n.item,
            credits: n.credits,
            cents: n.cents,
            ...(n.plan ? { plan: planName(n.plan) } : {}),
            ...(n.period ? { period: n.period } : {})
          }
        case 'payment_failed':
          return { kind: 'payment_failed', name, plan: planName(n.plan), link: this.mail.link('/connexion') }
        case 'plan_canceled':
          return { kind: 'plan_canceled', name, plan: planName(n.plan), link: this.mail.link('/tarifs') }
        case 'topup_failed':
          return { kind: 'topup_failed', name, credits: n.credits, cents: n.cents, link: this.mail.link('/connexion') }
      }
    })
  }

  /** The team's computers finished being created. */
  machinesReady(teamId: string, plan: PlanId, machineIds: readonly string[]): void {
    if (machineIds.length === 0) return
    const key = `machines-ready:${[...machineIds].sort().join(',')}`
    this.toTeam(teamId, key, (name) => ({ kind: 'machine_ready', name, plan: PLANS[plan].name, count: machineIds.length, link: this.mail.link('/bienvenue') }))
  }

  /** The team spent far more than usual in a day (spend-watch.ts): nothing is blocked, the team is asked to tell support if it was not them. */
  unusualSpend(teamId: string, credits: number, usual: number, day: string): void {
    this.toTeam(teamId, `spend-unusual:${teamId}:${day}`, (name) => ({ kind: 'spend_unusual', name, credits, usual, link: this.mail.link('/connexion') }))
  }

  private toTeam(teamId: string, key: string, template: (name: string) => Template): void {
    for (const a of this.accounts.billingContacts(teamId)) {
      this.mail.deliver({ to: a.email, lang: this.accounts.langOf(a.id), template: template(a.name), dedupeKey: `${key}:${a.id}`, accountId: a.id })
    }
  }
}
