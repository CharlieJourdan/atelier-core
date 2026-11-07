// What waits for the owner, as the bridge posts it in #à-valider, and how a decision made on Discord (a button
// « Valider une fois / Refuser / Toujours valider », a reaction ✅ / ❌, or a reply) is applied through the same services
// as the app: the runtime's inbox (`orchestra.answer`, and `allowAlways` for « toujours »), the workflow's deliverables
// (`approvals.approve` / `requestRevision`) and the production gates (`production.approve` / `requestChanges`).
import type { ApiContext } from '../api/context'
import { readInbox } from '../home/overview'
import { allowAlways, describeRule } from '../orchestra/allow'
import { GATE_NAMES } from '../orchestra/goals'
import { t, type MessageKey } from '../../shared/fr'
import { excerpt } from './format'
import { REACT_NO, REACT_OK, type DiscordActionRow, type DiscordButton } from './types'
import type { PendingRef, PostedRef } from './state'

export type Ctx = Pick<ApiContext, 'orchestra' | 'workflow' | 'productionRuns' | 'credits' | 'ledger' | 'agents' | 'example' | 'chat' | 'notify'>

export interface PendingItem {
  key: string
  ref: PendingRef
  /** The message to post. */
  text: string
  /** ✅ / ❌ can answer it (else: reply to the message, or the app). */
  reactions: boolean
  /** Its buttons (none for a question answered with text or files). */
  buttons: DiscordActionRow[]
  /** The name of the thread opened on it. */
  threadName: string
  /** The agent who asked (later messages in the thread go to it). */
  agentId: number | null
}

export type Decision = { kind: 'yes' } | { kind: 'no' } | { kind: 'text'; text: string } | { kind: 'always'; series: boolean }

/** The button ids: the message they sit on says which question. */
export const BUTTON = { yes: 'atl:yes', no: 'atl:no', always: 'atl:always', series: 'atl:series' } as const

const button = (custom_id: string, label: string, style: DiscordButton['style']): DiscordButton => ({ type: 2, style, label: excerpt(label, 80), custom_id })
const row = (...buttons: DiscordButton[]): DiscordActionRow[] => [{ type: 1, components: buttons }]

export const refKey = (r: PendingRef | PostedRef): string => (r.kind === 'gate' ? `gate:${r.runId}:${r.nodeId}` : `${r.kind}:${r.id}`)

export class Approvals {
  constructor(private readonly ctx: Ctx) {}

  /** Everything open right now. */
  pending(): PendingItem[] {
    const items: PendingItem[] = []
    for (const i of this.ctx.orchestra.inbox(false)) {
      const options = i.options
      let hint: string
      let reactions = false
      if (i.kind === 'validate') {
        reactions = true
        hint = options.length >= 2 ? `${REACT_OK} ${options[0]} · ${REACT_NO} ${options[1]}` : options.length === 1 ? `${REACT_OK} ${options[0]}` : `${REACT_OK} ${t('discord.yes')} · ${REACT_NO} ${t('discord.no')}`
        hint += `\n${t('discord.hint.reply')}`
      } else if (i.kind === 'alert') {
        reactions = true
        hint = `${REACT_OK} ${t('discord.hint.dismiss')}`
      } else if (i.kind === 'files') hint = t('discord.hint.files')
      else hint = t('discord.hint.input')
      const body = i.body ? `\n${excerpt(i.body, 700)}` : ''
      const gate = i.gate ? `\n${t('discord.item.gateLine', { gate: GATE_NAMES[i.gate] })}${i.series ? ` · ${t('discord.item.series', { series: i.series })}` : ''}` : ''
      const always = i.gate !== null && i.channelId !== null
      const buttons =
        i.kind === 'validate'
          ? row(
              button(BUTTON.yes, t('discord.button.once'), 3),
              button(BUTTON.no, t('discord.button.deny'), 4),
              ...(always && i.gate ? [button(BUTTON.always, t('discord.button.always', { gate: GATE_NAMES[i.gate] }), 1)] : []),
              ...(always && i.series ? [button(BUTTON.series, t('discord.button.series', { series: i.series }), 2)] : [])
            )
          : i.kind === 'alert'
            ? row(button(BUTTON.yes, t('discord.hint.dismiss'), 2))
            : []
      items.push({
        key: `inbox:${i.id}`,
        ref: { kind: 'inbox', id: i.id },
        text: `**${t(i.kind === 'alert' ? 'discord.item.alert' : 'discord.item.inbox')}** · ${i.title}${gate}${body}\n${hint}`,
        reactions,
        buttons,
        threadName: i.title,
        agentId: i.agentId
      })
    }
    const inbox = readInbox(this.ctx)
    for (const a of inbox.approvals) {
      const label = t(`home.deliverable.${a.deliverable.type}` as MessageKey)
      const body = a.version?.content ? `\n${excerpt(a.version.content, 700)}` : ''
      items.push({
        key: `approval:${a.deliverable.id}`,
        ref: { kind: 'approval', id: a.deliverable.id },
        text: `**${t('discord.item.approval')}** · ${label} — ${a.video.title}${body}\n${REACT_OK} ${t('discord.approve')} · ${REACT_NO} ${t('discord.reject')}\n${t('discord.hint.reply.note')}`,
        reactions: true,
        buttons: row(button(BUTTON.yes, t('discord.approve'), 3), button(BUTTON.no, t('discord.reject'), 4)),
        threadName: `${label} — ${a.video.title}`,
        agentId: null
      })
    }
    for (const g of inbox.gates) {
      items.push({
        key: `gate:${g.runId}:${g.nodeId}`,
        ref: { kind: 'gate', runId: g.runId, nodeId: g.nodeId },
        text: `**${t('discord.item.gate')}** · ${g.nodeLabel} — ${g.videoTitle} (${g.channelName})\n${REACT_OK} ${t('discord.approve')} · ${REACT_NO} ${t('discord.reject')}\n${t('discord.hint.reply.note')}`,
        reactions: true,
        buttons: row(button(BUTTON.yes, t('discord.approve'), 3), button(BUTTON.no, t('discord.reject'), 4)),
        threadName: `${g.nodeLabel} — ${g.videoTitle}`,
        agentId: null
      })
    }
    return items
  }

  /** Applies a decision; returns the line to post back. Throws the service's own message when it refuses. */
  apply(ref: PendingRef | PostedRef, decision: Decision): string {
    const { ctx } = this
    if (ref.kind === 'inbox') {
      const item = ctx.orchestra.inbox(false).find((i) => i.id === ref.id)
      if (!item) throw new Error(t('discord.err.gone'))
      if (item.kind === 'alert') {
        ctx.orchestra.answer(item.id, {})
        return t('discord.done.dismissed', { title: item.title })
      }
      if (decision.kind === 'always') {
        const done = allowAlways(ctx.orchestra, item.id, { series: decision.series })
        return t('discord.done.always', { rule: describeRule(done.rule), more: done.alsoAnswered ? t('discord.done.alsoAnswered', { n: done.alsoAnswered }) : '' })
      }
      if (decision.kind === 'text') {
        ctx.orchestra.answer(item.id, { text: decision.text })
        return t('discord.done.answered', { title: item.title })
      }
      const idx = decision.kind === 'yes' ? 0 : 1
      const choice = item.options[idx]
      if (item.options.length > 0 && choice === undefined) throw new Error(t('discord.err.noOption'))
      ctx.orchestra.answer(item.id, { text: choice ?? (decision.kind === 'yes' ? t('discord.yes') : t('discord.no')), ...(choice !== undefined ? { choice } : {}) })
      return t('discord.done.answered', { title: item.title })
    }
    if (decision.kind === 'always') throw new Error(t('discord.err.alwaysInbox'))
    if (ref.kind === 'approval') {
      const found = ctx.workflow.pendingApprovals().find((a) => a.deliverable.id === ref.id)
      if (!found) throw new Error(t('discord.err.gone'))
      const versionId = found.version?.id
      const base = { by: 'owner', ...(versionId !== undefined ? { versionId } : {}) }
      if (decision.kind === 'yes') {
        ctx.workflow.approve(ref.id, { ...base, note: t('discord.note.approved') })
        ctx.notify('videos')
        return t('discord.done.approved', { title: found.video.title })
      }
      ctx.workflow.requestRevision(ref.id, { ...base, note: decision.kind === 'text' ? decision.text : t('discord.note.rejected') })
      ctx.notify('videos')
      return t('discord.done.rejected', { title: found.video.title })
    }
    // gate
    if (decision.kind === 'yes') {
      ctx.productionRuns.approve(ref.runId, ref.nodeId)
      ctx.notify('production')
      return t('discord.done.gateApproved', { node: ref.nodeId })
    }
    ctx.productionRuns.requestChanges(ref.runId, ref.nodeId, decision.kind === 'text' ? decision.text : t('discord.note.rejected'))
    ctx.notify('production')
    return t('discord.done.gateRejected', { node: ref.nodeId })
  }
}
