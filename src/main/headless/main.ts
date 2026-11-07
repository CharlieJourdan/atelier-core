// `npm run brain:headless`: Atelier's brain on the team computer, without Electron (docs/BRAIN-HEADLESS.md). Plain Node
// runs this TypeScript through scripts/ts-transpile.mjs. Prints where it listens and, on first start, the token ONCE;
// then serves until SIGINT / SIGTERM. `--rotate-token` is an offline command: a new token, printed once, and exit.
// `--backup-now`, `--list-backups`, `--restore` are the backup commands (backup-cli.ts).
// Exit codes: 0 stopped, 1 failed, 2 bad options, 3 the port is taken (a brain already runs): the keeper does not retry 2 or 3.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatReport, housekeep } from '../../engine/render/housekeeping'
import { cleanDataOptions } from './clean-data'
import { backupCommand } from './backup-cli'
import { ConfigError, HELP, isLoopback, parseHeadlessArgs } from './config'
import { startHeadless } from './host'
import { RotateRefused, rotateOffline } from './token'

const out = (line: string): void => void process.stdout.write(line + '\n')
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// solidite: under plain Node an unhandled rejection kills the process, and every live run with it (the keeper then
// restarts the brain and the runs resume, but the cause is lost). It is written to the journal and the brain goes on.
process.on('unhandledRejection', (reason: unknown) => {
  process.stderr.write(`Erreur non gérée (le cerveau continue) : ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}
`)
})

async function main(): Promise<number> {
  let args
  try {
    args = parseHeadlessArgs(process.argv.slice(2))
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(err.message + '\n')
      return 2
    }
    throw err
  }
  if (args.help) {
    out(HELP)
    return 0
  }
  // An offline command: a new token for the stopped brain, printed once; no database is opened, no service started.
  if (args.rotateToken) {
    try {
      const token = await rotateOffline({ dataDir: args.dataDir, host: args.host, port: args.port })
      out('Nouveau jeton d’accès (affiché UNE seule fois, copie-le maintenant dans Réglages › Ordinateur d’équipe) :')
      out(`  ${token}`)
      out('L’ancien ne marche plus. Démarre (ou redémarre) le cerveau : systemctl start atelier-brain, ou npm run brain:headless.')
      return 0
    } catch (err) {
      if (err instanceof RotateRefused) {
        process.stderr.write(err.message + '\n')
        return 1
      }
      throw err
    }
  }
  // The render leftovers: a dry run unless --apply (the brain may be running: files used in the last hour are spared).
  if (args.cleanData) {
    const { brainRunning, ...o } = cleanDataOptions({ dataDir: args.dataDir, apply: args.cleanApply, budgetGb: args.budgetGb })
    const r = await housekeep(path.join(args.dataDir, 'production'), o)
    out(o.sparedMs === 0 ? '  Cerveau arrêté sur ce dossier : rien de refaisable n’est épargné.' : brainRunning ? '  Un cerveau tourne sur ce dossier : ce qui a servi dans la dernière heure est épargné.' : '  Aucun cerveau connu sur ce dossier (pas de brain-run.pid) : ce qui a servi dans la dernière heure est épargné.')
    for (const line of formatReport(r)) out(line)
    if (!r.applied) out('  Pour supprimer pour de bon : relance avec --apply.')
    return 0
  }
  if (args.backupNow || args.listBackups || args.restore !== null) return backupCommand(args, { repoRoot, out })
  let brain
  try {
    brain = await startHeadless({ ...args, backup: args.backup ? { at: args.backupAt } : undefined, repoRoot, log: out })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      process.stderr.write(`Le port ${args.port} est déjà pris : un cerveau tourne déjà (ou un autre programme).
`)
      return 3
    }
    throw err
  }
  out(`Atelier — cerveau sans écran, version ${brain.core.context.appInfo().version}`)
  out(`  données   ${args.dataDir}`)
  out(`  écoute    ${brain.url}  (POST /rpc, GET /events)`)
  if (brain.cloud) out('  cloud     Atelier Cloud : relais sortant, aucun port ouvert (l’état suit dans ce journal)')
  const nextBackup = brain.health().nextBackupAt
  out(`  sauvegarde ${nextBackup ? `chaque nuit à ${String(args.backupAt.hour).padStart(2, '0')}:${String(args.backupAt.minute).padStart(2, '0')}, prochaine ${new Date(nextBackup).toLocaleString('fr-FR')}` : 'aucune (--no-backup)'}`)
  if (args.origins.length > 0) out(`  origines  ${args.origins.join(', ')}`)
  if (!isLoopback(args.host)) {
    out(`  ATTENTION : écoute sur ${args.host}, pas seulement sur cette machine. Préfère 127.0.0.1 + un tunnel SSH, ou un pare-feu.`)
  }
  // As a service (--cloud-enrol), stdout is the system journal: the direct-access token is not written there; the
  // operator makes one by hand (service stopped, --rotate-token in a terminal).
  if (brain.newToken && args.cloudEnrol) {
    out('  jeton     créé, non affiché (service relié à Atelier Cloud ; service arrêté, --rotate-token dans un terminal pour en avoir un)')
  } else if (brain.newToken) {
    out('')
    out('  Jeton d’accès (affiché UNE seule fois, copie-le maintenant dans Réglages › Ordinateur d’équipe) :')
    out(`  ${brain.newToken}`)
    out('  Perdu ? Arrête le cerveau et lance --rotate-token : un nouveau jeton remplace l’ancien.')
    out('')
  } else {
    out('  jeton     déjà créé (non réaffiché ; cerveau arrêté, --rotate-token pour en faire un nouveau)')
  }
  const port = new URL(brain.url).port
  out(`  tunnel    depuis ton ordinateur : ssh -N -L ${port}:127.0.0.1:${port} <toi>@<ordinateur-d-equipe>`)
  out('Prêt.')
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  out('Arrêt…')
  await brain.close()
  return 0
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`Le cerveau n’a pas démarré : ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
)
