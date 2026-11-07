// `production.list` (read-only): what is in production now, for Atlas and the channel leads — the runs in progress
// (title, channel, state, the step running or the gate waiting for Charlie, progress, credits) and the projects not
// finished yet. A channel's agent sees its own channel only. Reads the same services as the Production screen.
import { ACTIVE_RUN_STATUSES, type RunSummary } from '../../shared/runs'
import { int, type ToolCtx } from './tool-args'

const LIMIT = 30

export function productionList(c: ToolCtx, a: Record<string, unknown>): string {
  const production = c.env.services.production
  if (!production) throw new Error('The production engine is not available in this app')
  const asked = a.channel === undefined ? null : int(a.channel, 'channel')
  if (asked !== null && c.agent.channelId !== null && asked !== c.agent.channelId) throw new Error('You can only see the runs of your own channel')
  const channelId = asked ?? c.agent.channelId
  const all = a.all === true
  const runs = production.list({ ...(channelId !== null ? { channelId } : {}), limit: LIMIT }).filter((r) => all || ACTIVE_RUN_STATUSES.includes(r.status))
  const projects = (c.env.services.projects?.list(channelId !== null ? { channelId } : {}) ?? []).filter(
    (p) => p.runId === null || (p.runStatus !== null && (ACTIVE_RUN_STATUSES as readonly string[]).includes(p.runStatus))
  )
  const lines = [
    runs.length ? `Runs ${all ? 'of late' : 'in progress'} (${runs.length}):` : `No run ${all ? 'yet' : 'in progress'}.`,
    ...runs.map(runLine),
    projects.length ? `Projects not finished (${projects.length}):` : 'No project waiting.',
    ...projects.map((p) => `- project #${p.id} "${p.title}" (recipe ${p.recipeName} v${p.recipeVersion}${p.channelId !== null ? `, channel #${p.channelId}` : ''}): ${p.runId === null ? 'not launched' : `run #${p.runId} ${p.runStatus ?? ''}`}`)
  ]
  return lines.join('\n')
}

function runLine(r: RunSummary): string {
  const where = r.waitingNodes.length ? `waits for Charlie at ${r.waitingNodes.join(', ')}` : r.current ? `now: ${r.current.label}${r.current.step ? ` (${r.current.step})` : ''}` : r.status
  return `- run #${r.id} "${r.videoTitle}" · ${r.channelName} · ${r.status} · ${Math.round(r.progress * 100)} % · ${where}${r.demo ? ' · demo' : ''}${r.error ? ` · error: ${r.error}` : ''} · ${r.spentCredits}/${r.quoteCredits} credits`
}
