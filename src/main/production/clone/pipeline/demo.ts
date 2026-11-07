// Proof driver (chantier moteur-pipeline, decision 0099), run by tests/unit/clone-pipeline-proof.test.ts when CLONE_PIPELINE_RUN_DIR is
// set: builds the P5 plans of the four acceptance channels (Finary, Marcel, the Japanese Method in French, Le Monde en POV) from their
// fixture Style Definitions, compiles each into a recipe and RUNS it end to end on this machine with the engine's fakes (template
// script, system voice, drawn pictures and presenter) while the local bricks are real: the director, the channel-styled motion
// cards drawn by the browser, the captions, the music bed, the render. Saves each film, its plan and frames to look at (every
// motion card's middle frame, plus four frames of the film). Free and offline. Never used by the app.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BASE_PIPELINES } from '../../../../engine/technologies/bases'
import { phaseContext } from '../context'
import { FINARY, JAPANESE, MARCEL, MONDE_POV } from '../definition/fixtures/profiles'
import { runDefinition } from '../definition/fixtures/run'
import { fakeChannel } from '../fakes/channels'
import { fakeServices } from '../fakes/services'
import { buildPlan, checkP5 } from '../p5-plan'
import { runPlanOnFakes } from './fake-run'
import { CloneStore } from '../store'

const ffmpeg = (args: string[]): boolean => spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { windowsHide: true }).status === 0
const ffprobeS = (file: string): number => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true }).stdout.trim()) || 0

export async function runAcceptanceOnFakes(o: { outDir: string; resourcesDir: string; minutes: number; only?: string[]; say(s: string): void }): Promise<string[]> {
  const failed: string[] = []
  const outDir = o.outDir
  const minutes = o.minutes
  const say = o.say
  const CHANNELS = [
    { name: 'finary', topic: 'Pourquoi ton épargne perd de la valeur chaque année', run: () => runDefinition(FINARY) },
    { name: 'marcel', topic: 'Purger ses radiateurs avant l’hiver', run: () => runDefinition(MARCEL, { intent: 'own-channel', ownChannel: true }) },
    { name: 'japanese', topic: 'Ranger sa cuisine à la japonaise', run: () => runDefinition(JAPANESE, { intent: 'translate', language: 'fr', sourceLanguage: 'en' }) },
    { name: 'monde-pov', topic: 'Et si tu gagnais au loto demain ?', run: () => runDefinition(MONDE_POV) }
  ].filter((c) => !o.only || o.only.includes(c.name))
  
  
for (const c of CHANNELS) {
  const dir = path.join(outDir, c.name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const r = await c.run()
  const { services } = fakeServices(fakeChannel('presenter-motion'))
  const ctx = phaseContext(new CloneStore(path.join(dir, 'store'), c.name), services, 10)
  const plan = buildPlan(ctx, r.brief, r.definition, r.feasibility)
  writeFileSync(path.join(dir, 'p5-pipeline-plan.json'), JSON.stringify(plan, null, 2) + '\n')
  const check = checkP5(plan, r.definition, BASE_PIPELINES)
  if (!check.ok) {
    failed.push(c.name)
    say(`FAIL ${c.name}: checkP5 — ${check.problems.join(' | ')}`)
    continue
  }
  const res = await runPlanOnFakes({ plan, dataDir: path.join(dir, 'data'), resourcesDir: o.resourcesDir, minutes, topic: c.topic })
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify(res, null, 2) + '\n')
  if (res.status !== 'done' || !res.video) {
    failed.push(c.name)
    say(`FAIL ${c.name}: run ${res.status} ${res.errors.map((e) => `${e.nodeId}: ${e.code} ${e.message}`).join(' | ').slice(0, 800)}`)
    continue
  }
  const film = path.join(dir, `${c.name}.mp4`)
  ffmpeg(['-i', res.video, '-c', 'copy', film])
  const len = ffprobeS(film)
  for (const [i, t] of [0.1, 0.35, 0.6, 0.85].entries()) ffmpeg(['-ss', (len * t).toFixed(2), '-i', film, '-frames:v', '1', '-vf', 'scale=960:-2', path.join(dir, `film-${i + 1}.jpg`)])
  res.motionFiles.forEach((f, i) => {
    const s = ffprobeS(f)
    ffmpeg(['-ss', (s * 0.6).toFixed(2), '-i', f, '-frames:v', '1', '-vf', 'scale=960:-2', path.join(dir, `card-${i + 1}.png`)])
  })
  say(`PASS ${c.name}: ${plan.bricks.map((b) => b.tech ?? b.node).join(' → ')} — ${len.toFixed(1)} s film, ${res.motionFiles.length} motion cards, ${(res.ms / 1000).toFixed(0)} s`)
}
return failed
}
