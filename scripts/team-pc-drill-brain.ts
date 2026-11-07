// The brain the crash drill (scripts/team-pc-drill.ts) kills: the real headless host (startHeadless) on the drill's data
// folder, with a scripted team instead of a model (no network, no cost). Its principal gets ONE task, « create the drill
// channel »: the turn calls the real `channel.create` tool (a side effect, recorded in orch_effects), then — while the
// file `<data>/drill-hang` exists — hangs in the middle of the turn, as a CLI would that is waiting on the model. The
// drill kills the process there. Started again, the brain takes the task back (recover), the turn calls the tool again,
// finds the effect, and finishes; this process then stops by itself (exit 0) once the drill task is done.
//   node --import ./scripts/ts-transpile.mjs scripts/team-pc-drill-brain.ts <data dir> <machine key file>
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHeadless } from '../src/main/headless/host'
import { FakeProvider } from '../src/main/llm/fake'
import { ProviderError, type CallOptions, type CompletionRequest, type StreamEvent } from '../src/main/llm/types'
import { scriptedReply } from '../src/main/orchestra/fake-team'

export const DRILL_MARK = 'DRILL-TASK'
export const DRILL_CHANNEL = 'Chaîne de l’exercice'
const block = (actions: unknown[]): string => `\n\n\`\`\`atelier\n${JSON.stringify({ actions })}\n\`\`\``

const [dataDir, keyFile] = process.argv.slice(2)
if (!dataDir || !keyFile) {
  process.stderr.write('usage: team-pc-drill-brain.ts <data dir> <key file>\n')
  process.exit(2)
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = (name: string): string => path.join(dataDir, name)
const say = (line: string): void => void process.stdout.write(`[cerveau ${process.pid}] ${line}\n`)

/** The scripted team: the drill task does its side effect itself, then hangs or finishes; anything else answers as the demo team. */
class DrillProvider extends FakeProvider {
  constructor() {
    super((req) => (req.prompt.includes(DRILL_MARK) ? 'Chaîne créée.' + block([{ type: 'done', result: `${DRILL_CHANNEL} prête.` }]) : scriptedReply(req.system ?? '', req.prompt)), 'drill')
  }

  override async *stream(req: CompletionRequest, opts: CallOptions = {}): AsyncGenerator<StreamEvent> {
    if (req.prompt.includes(DRILL_MARK)) {
      if (!req.tools) throw new ProviderError('drill: the turn has no tools', 'FAILED')
      const r = await req.tools.call('channel_create', { name: DRILL_CHANNEL, niche: 'exercice de panne' })
      appendFileSync(at('drill-tool-calls.log'), `${process.pid}\t${r.isError ? 'error' : 'ok'}\t${r.text.split('\n')[0] ?? ''}\n`)
      if (existsSync(at('drill-hang'))) {
        writeFileSync(at('drill-midturn'), String(process.pid))
        say('tour en cours : la chaîne est créée, le modèle « réfléchit » encore…')
        await new Promise<void>((_, reject) => opts.signal?.addEventListener('abort', () => reject(new ProviderError('Aborted', 'ABORTED'))))
      }
    }
    yield* super.stream(req, opts)
  }
}

const provider = new DrillProvider()
const brain = await startHeadless({
  dataDir,
  keyFile,
  host: '127.0.0.1',
  port: 0,
  origins: [],
  repoRoot,
  env: { ATELIER_RUNNER: 'off', ATELIER_AUTOMATIONS: 'off', ATELIER_EXAMPLE: '0' },
  core: { orchestra: { providers: () => provider, intervalMs: 200 } }
})
const core = brain.core
const db = core.db
const drillTask = (): { id: number; status: string; attempts: number } | undefined =>
  db.prepare(`SELECT id, status, attempts FROM orch_tasks WHERE title = 'Créer la chaîne de l’exercice'`).get() as { id: number; status: string; attempts: number } | undefined

if (!drillTask()) {
  // first start: the team, a checked account, the team switched on (kept in the database), the task approved by Charlie
  core.orchestra.seed()
  db.prepare(`UPDATE orch_accounts SET state = 'ready', checked_at = ?`).run(new Date().toISOString())
  const principal = core.orchestra.parts.tree.bySlug('principal')
  if (!principal) throw new Error('no principal')
  core.orchestra.parts.queue.enqueue({
    kind: 'task',
    title: 'Créer la chaîne de l’exercice',
    assigneeId: principal.id,
    payload: { brief: `${DRILL_MARK}: crée la chaîne « ${DRILL_CHANNEL} »`, human: [{ choice: 'Valider' }] },
    priority: 9,
    channelId: null
  })
  await core.api['autopilot.setPower']({ state: 'on' })
  say('équipe allumée, tâche donnée au principal')
} else {
  say(`redémarré : tâche #${drillTask()?.id} trouvée « ${drillTask()?.status} » (reprise par recover)`)
}

const timer = setInterval(() => {
  const t = drillTask()
  if (t?.status !== 'done') return
  clearInterval(timer)
  say(`tâche #${t.id} finie (tentatives : ${t.attempts})`)
  void brain.close().then(() => process.exit(0))
}, 100)
setTimeout(() => {
  say('la tâche ne finit pas : échec')
  process.exit(1)
}, 60_000).unref()
