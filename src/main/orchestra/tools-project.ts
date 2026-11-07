// The team's production of a planned video (agents-production, chantier B): `project.prepare` gives a video of the
// agent's channel its project on the channel's pipeline (the owner's imported script it already carries, or a script the
// team wrote), and quotes it; `project.run` launches it — the same path as the app's « Lancer la fabrication »
// (production-16): a demo run unless `real` is asked, which needs Charlie's yes in this task AND the quote within what is
// left of the channel's monthly budget (its goals). The run stops at its gates; Charlie answers them in his inbox.
import { lintScript } from '../../engine/text/lint'
import type { ProjectDetail } from '../../shared/recipes'
import { realRunAllowed } from './goals'
import { isSlotTitle } from './plan'
import { readTeamFile, spentThisMonth } from './tools-work'
import { int, need, opt, type Handler, type ToolCtx } from './tool-args'
import { truncate } from './util'

function service(c: ToolCtx): NonNullable<ToolCtx['env']['services']['teamProjects']> {
  const s = c.env.services.teamProjects
  if (!s) throw new Error('Production projects are not available here')
  return s
}

/** A video of the agent's channel (an agent of one channel never touches another channel's videos). */
function ownVideo(c: ToolCtx, raw: unknown): { id: number; channelId: number; title: string; status: string } {
  const id = int(raw, 'video')
  const v = c.env.db.prepare('SELECT id, channel_id, title, status FROM videos WHERE id = ?').get(id) as { id: number; channel_id: number; title: string; status: string } | undefined
  if (!v) throw new Error(`No video #${id}`)
  const mine = c.agent.channelId ?? c.channelId
  if (mine !== null && v.channel_id !== mine) throw new Error(`Video #${id} is not one of your channel's videos`)
  if (v.status === 'cancelled' || v.status === 'published') throw new Error(`Video #${id} is ${v.status}`)
  return { id: v.id, channelId: v.channel_id, title: v.title, status: v.status }
}

function ownProject(c: ToolCtx, raw: unknown): ProjectDetail {
  const p = service(c).get(int(raw, 'project'))
  const mine = c.agent.channelId ?? c.channelId
  if (mine !== null && p.channelId !== mine) throw new Error(`Project #${p.id} is not one of your channel's projects`)
  return p
}


export const PROJECT_TOOLS: Record<string, Handler> = {
  'project.prepare': async (c, a) => {
    const svc = service(c)
    const video = ownVideo(c, a.video)
    const title = opt(a.title, 'title', 200)
    const idea = opt(a.idea, 'idea', 2000)
    if ((title === undefined) !== (idea === undefined)) throw new Error('Give the topic as both title and idea')
    if (a.fresh !== undefined && typeof a.fresh !== 'boolean') throw new Error('fresh: true or false')
    // fresh: the video's run is over and refused (QC) or failed: a new project to remake it (production-equipe)
    let p = a.fresh === true ? svc.remake(video.id) : svc.ensureForVideo(video.id, a.pipeline === undefined ? undefined : int(a.pipeline, 'pipeline'))
    if (title !== undefined && idea !== undefined) {
      if (p.runId !== null) throw new Error(`Project #${p.id} is launched already: its topic no longer changes`)
      p = svc.setTopic(video.id, title, idea) ?? p
    }
    const text = a.script !== undefined ? need(a.script, 'script', 200_000) : a.scriptFile !== undefined ? readTeamFile(c, need(a.scriptFile, 'scriptFile', 300)) : undefined
    const takes = svc.takesScript(p.id)
    if (text !== undefined && takes) {
      if (p.runId !== null) throw new Error(`Project #${p.id} is launched already: its script no longer changes`)
      p = svc.setScript(p.id, text)
    }
    const script = svc.scriptOf(p.id)
    const q = await svc.quote(p.id, false)
    const usage = q.modes.usage_max
    const scriptLine = !takes
      ? `Its pipeline writes the script itself from the topic${text !== undefined ? ': the script given is not attached; put its outline in idea (with title) so the pipeline follows it' : ''}.`
      : script
        ? `Script attached: ${lintScript(script).words} words.`
        : 'NO SCRIPT YET: its pipeline reads one. Attach it (script or scriptFile) before project_run.'
    return [
      `Project #${p.id} for video #${video.id} « ${truncate(p.title, 80)} » on the pipeline ${p.recipeName} v${p.recipeVersion}${p.runId !== null ? ` (launched: run #${p.runId}, ${p.runStatus ?? '?'})` : ''}.`,
      isSlotTitle(p.title) ? 'NO TOPIC YET: save it with title and idea before project_run (the run would be about « Vidéo du … »).' : `Topic (the run's): ${truncate(p.idea.replace(/\s+/g, ' '), 300)}`,
      scriptLine,
      `Quote: ${usage.totalCredits} credits (${usage.totalEur.toFixed(2)} €) if made for real; a demo run spends nothing.${q.real.available ? '' : ` Real engine not available now: ${q.real.reason}`}`,
      p.runId === null ? `Next: project_run with project ${p.id}.` : ''
    ]
      .filter(Boolean)
      .join('\n')
  },
  'project.run': async (c, a) => {
    const done = c.effect('project-run')
    if (typeof done === 'number') return `Already launched in this task: run #${done}.`
    const svc = service(c)
    if (a.project === undefined && a.video === undefined) throw new Error('Give the project (or its video)')
    const p = a.project !== undefined ? ownProject(c, a.project) : svc.ensureForVideo(ownVideo(c, a.video).id)
    if (a.real !== undefined && typeof a.real !== 'boolean') throw new Error('real: true or false')
    const real = a.real === true
    const why = opt(a.why, 'why', 300)
    // never a run about the slot's placeholder: the pipeline would write a video about « Vidéo du jeu. 5 nov. » (run #1)
    if (isSlotTitle(p.title) && isSlotTitle(p.idea)) throw new Error(`Video #${p.videoId ?? '?'} has no topic yet: save it first (project_prepare with video, title and idea), then launch`)
    if (real) {
      // « Moteur réel » is off by default (decision 0044): real credits only with Charlie's yes, or on a channel he left to
      // the team (confirmed budget, a level that gates neither voice nor video: realRunAllowed), within the channel's budget
      const goals = p.channelId !== null ? c.env.goals.get(p.channelId) : null
      if (!c.approved() && !realRunAllowed(goals)) throw new Error('A real run spends real credits: ask Charlie first (ask_human, kind validate), then launch it in your next turn')
      const q = await svc.quote(p.id, true)
      const left = (goals?.budgetCredits ?? 0) - (p.channelId !== null ? spentThisMonth(c, p.channelId) : 0)
      const credits = q.modes[q.budgetMode ?? 'usage_max'].totalCredits
      if (credits > left) throw new Error(`The real run would cost ${credits} credits; ${Math.max(0, left)} are left in the channel's budget this month. Run it as a demo, or ask Charlie to raise the budget.`)
    }
    const d = await svc.run(p.id, real)
    if (d.runId === null) throw new Error('The run did not start')
    c.remember('project-run', d.runId)
    const run = c.env.services.production?.get(d.runId)
    return `Launched ${real ? 'a REAL' : 'a demo'} run #${d.runId} of project #${p.id} « ${truncate(p.title, 80)} »${run ? ` (${run.status}, ${run.quoteCredits} credits held)` : ''}.${why ? ` Why: ${why}.` : ''} It stops at its gates: Charlie answers them in his inbox. Its end (success or failure) is reported to the team.`
  }
}
