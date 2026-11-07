// `npm run team-pc:drill` — the team computer's crash drill (docs/BRAIN-HEADLESS.md §10), free and offline: a scratch
// data folder, a scripted team (no model, no network), the real headless brain (scripts/team-pc-drill-brain.ts) run by
// the real keeper (src/main/headless/keeper.ts), as the scheduled task runs it.
//   1. The brain's principal creates a channel (a real side effect, recorded in orch_effects) and is still in its turn
//      when the drill KILLS the process (SIGKILL: no cleanup, no close, like a power cut of the process).
//   2. A copy of the files the dead process left is opened: the WAL is there, the database is intact, the task is still
//      leased/running and the channel exists once.
//   3. The keeper starts the brain again by itself; recover() takes the task back, the turn calls the tool again and
//      finds the effect: the task finishes ONCE, with ONE channel.
//   4. A backup of the folder, restored into an empty folder, gives the same agents, queue, goals and channels.
// Exit 0 = every check holds. `--keep` keeps the scratch folder.
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { backupKey } from '../src/main/headless/backup-archive'
import { restoreBackup, runBackup } from '../src/main/headless/backup'
import { loadMachineKey } from '../src/main/headless/cipher'
import { Keeper } from '../src/main/headless/keeper'

const KEEP = process.argv.includes('--keep')
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = (s: string): void => void process.stdout.write(s + '\n')
const failures: string[] = []
const check = (ok: boolean, what: string): void => {
  out(`  ${ok ? 'OK ' : 'NON'} ${what}`)
  if (!ok) failures.push(what)
}

const root = mkdtempSync(path.join(os.tmpdir(), 'atelier-team-pc-drill-'))
const data = path.join(root, 'data')
const keyFile = path.join(root, 'secrets', 'machine.key')
mkdirSync(data, { recursive: true })
const at = (name: string): string => path.join(data, name)
const TASK = `title = 'Créer la chaîne de l’exercice'`

async function until(test: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms
  while (!test()) {
    if (Date.now() > end) throw new Error(`délai dépassé : ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

function query<T>(dbFile: string, sql: string): T[] {
  const db = new DatabaseSync(dbFile)
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}

async function main(): Promise<void> {
  out(`Exercice de panne du PC d’équipe — dossier de test ${root}`)
  out('')
  out('1. Le cerveau démarre sous son gardien ; l’équipe crée une chaîne ; le cerveau est tué en plein tour.')
  writeFileSync(at('drill-hang'), '1')
  const brains: ChildProcess[] = []
  const keeper = new Keeper({
    log: (l) => out(`  ${l}`),
    delaysMs: [1000],
    spawnBrain: (env) => {
      const child = spawn(
        process.execPath,
        [
          '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
          '--disable-warning=ExperimentalWarning',
          '--import',
          pathToFileURL(path.join(repoRoot, 'scripts', 'ts-transpile.mjs')).href,
          path.join(repoRoot, 'scripts', 'team-pc-drill-brain.ts'),
          data,
          keyFile
        ],
        { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }
      )
      child.stdout?.on('data', (b: Buffer) => process.stdout.write(b.toString().replace(/^/gm, '  ')))
      child.stderr?.on('data', (b: Buffer) => process.stdout.write(b.toString().replace(/^/gm, '  ! ')))
      brains.push(child)
      return child
    }
  })
  const kept = keeper.run()
  await until(() => existsSync(at('drill-midturn')), 90_000, 'le premier tour')
  const victim = brains[0] as ChildProcess
  // the next brain must not hang: the marker goes before the kill
  unlinkSync(at('drill-hang'))
  victim.kill('SIGKILL')
  await new Promise<void>((resolve) => (victim.exitCode !== null || victim.signalCode !== null ? resolve() : victim.once('exit', () => resolve())))
  out(`  cerveau ${victim.pid ?? '?'} tué (SIGKILL) en plein tour`)

  out('')
  out('2. Ce que le processus mort a laissé (une copie, pour ne rien réparer à la place du cerveau) :')
  const wal = at('atelier.db-wal')
  check(existsSync(wal) && statSync(wal).size > 0, `le journal WAL est là (${existsSync(wal) ? statSync(wal).size : 0} octets)`)
  const copy = path.join(root, 'apres-panne')
  mkdirSync(copy)
  for (const f of ['atelier.db', 'atelier.db-wal', 'atelier.db-shm']) if (existsSync(at(f))) copyFileSync(at(f), path.join(copy, f))
  const crashed = path.join(copy, 'atelier.db')
  check(query<{ integrity_check: string }>(crashed, 'PRAGMA integrity_check')[0]?.integrity_check === 'ok', 'la base est intacte (integrity_check = ok)')
  const midTask = query<{ status: string }>(crashed, `SELECT status FROM orch_tasks WHERE ${TASK}`)[0]
  check(midTask?.status === 'running' || midTask?.status === 'leased', `la tâche est restée « ${midTask?.status ?? '?'} » (le tour n’a pas fini)`)
  check(query<{ n: number }>(crashed, `SELECT COUNT(*) AS n FROM channels WHERE name = 'Chaîne de l’exercice'`)[0]?.n === 1, 'la chaîne créée avant la panne est enregistrée une fois')
  check(query<{ n: number }>(crashed, `SELECT COUNT(*) AS n FROM orch_effects e JOIN orch_tasks t ON t.id = e.task_id WHERE t.${TASK}`)[0]?.n === 1, 'l’effet est noté pour la tâche (orch_effects)')

  out('')
  out('3. Le gardien relance le cerveau tout seul ; la tâche reprend et finit une seule fois.')
  const code = await kept
  check(code === 0 && brains.length === 2, `le gardien a relancé le cerveau une fois (${brains.length} démarrages), puis s’est arrêté proprement`)
  const db = at('atelier.db')
  const task = query<{ id: number; status: string; attempts: number }>(db, `SELECT id, status, attempts FROM orch_tasks WHERE ${TASK}`)
  check(task.length === 1 && task[0]?.status === 'done', `une seule tâche, finie (« ${task[0]?.status ?? '?'} », tentatives : ${task[0]?.attempts ?? '?'})`)
  check(query<{ n: number }>(db, `SELECT COUNT(*) AS n FROM channels WHERE name = 'Chaîne de l’exercice'`)[0]?.n === 1, 'toujours UNE chaîne : l’effet n’a pas été refait')
  const calls = readFileSync(at('drill-tool-calls.log'), 'utf8').trim().split('\n')
  check(calls.length === 2 && /Already done/.test(calls[1] ?? ''), `l’outil a été rappelé après la panne et a trouvé l’effet (« ${(calls[1] ?? '').split('\t')[2] ?? ''} »)`)
  const recovered = query<{ text: string }>(db, `SELECT text FROM orch_events WHERE type = 'recover'`)
  check(recovered.length === 1, `recover() au redémarrage : « ${recovered[0]?.text ?? 'rien'} »`)

  out('')
  out('4. Sauvegarde du dossier, puis restauration dans un dossier vide.')
  const key = backupKey(loadMachineKey(keyFile))
  const saved = await runBackup({ dataDir: data, key, appVersion: 'drill', link: () => null, log: (l) => out(`  ${l}`) })
  check(saved.ok && saved.localFile !== null, `archive chiffrée écrite (${saved.sizeBytes} octets)`)
  const target = path.join(root, 'restaure', 'data')
  const r = restoreBackup({ bytes: readFileSync(saved.localFile ?? ''), key, dataDir: target })
  const same = (sql: string): boolean => JSON.stringify(query(db, sql)) === JSON.stringify(query(path.join(target, 'atelier.db'), sql))
  check(same('SELECT slug, role, channel_id, status FROM orch_agents ORDER BY id'), `mêmes agents (${r.agents})`)
  check(same('SELECT id, kind, title, status, attempts FROM orch_tasks ORDER BY id'), `même file de tâches (${r.tasks})`)
  check(same('SELECT * FROM channel_goals ORDER BY channel_id'), `mêmes objectifs (${r.goals})`)
  check(same('SELECT id, name FROM channels ORDER BY id'), `mêmes chaînes (${r.channels})`)

  out('')
  if (failures.length) {
    out(`ÉCHEC : ${failures.length} point(s) ne tiennent pas.`)
    process.exitCode = 1
  } else {
    out('Tout tient : panne en plein tour, reprise par le gardien, tâche finie une fois, sauvegarde restaurée.')
  }
}

main()
  .catch((err: unknown) => {
    out(`ÉCHEC : ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(() => {
    if (KEEP) out(`(dossier gardé : ${root})`)
    else rmSync(root, { recursive: true, force: true })
  })
