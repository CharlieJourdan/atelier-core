// The backup commands of `npm run brain:headless` (docs/BRAIN-HEADLESS.md §10): `--backup-now` and `--list-backups` (the
// brain may be running: the snapshot reads the database from its own connection) and `--restore <source>` into a data
// folder without a database. A restore from Atelier Cloud uses the folder's stored machine credential, or enrols with
// the enrolment file first (a new machine of the team). Nothing here prints a token or a credential.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { backupKey, BackupError } from './backup-archive'
import { downloadCloudBackup, listCloudBackups, LOCAL_DIR, restoreBackup, runBackup } from './backup'
import { fileKeyCipher, loadMachineKey } from './cipher'
import { enrolMachine, neutraliseEnrolFile, parseEnrolFile, readStoredLink, writeStoredLink, type CloudMachineLink } from './cloud-link'
import type { HeadlessArgs } from './config'

export interface BackupCliDeps {
  repoRoot: string
  out: (line: string) => void
  fetchImpl?: typeof fetch
}

const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)} Mo`

function appVersion(repoRoot: string): string {
  try {
    return (JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** The machine key, never created here: a restore needs the key of the machine that made the backup. */
function existingKey(file: string): Buffer {
  if (!existsSync(file)) throw new BackupError('WRONG_KEY', `Clé de la machine introuvable (${file}) : donne celle de l’ordinateur qui a fait la sauvegarde avec --key-file.`)
  return loadMachineKey(file)
}

/** The data folder's Cloud link, or (restore on a new machine) an enrolment with the enrolment file, stored in the folder. */
async function linkFor(args: HeadlessArgs, enrolIfNeeded: boolean, fetchImpl?: typeof fetch): Promise<CloudMachineLink | null> {
  if (!args.cloud) return null
  const cipher = fileKeyCipher(existingKey(args.keyFile))
  const stored = readStoredLink(args.dataDir, cipher)
  if (stored || !enrolIfNeeded || !existsSync(args.enrolFile)) return stored
  const target = parseEnrolFile(readFileSync(args.enrolFile, 'utf8'))
  const link = await enrolMachine(target.cloudUrl, target.token, fetchImpl)
  mkdirSync(args.dataDir, { recursive: true, mode: 0o700 })
  writeStoredLink(args.dataDir, cipher, link)
  neutraliseEnrolFile(args.enrolFile)
  return link
}

/** Runs one of the backup commands; returns the exit code. */
export async function backupCommand(args: HeadlessArgs, d: BackupCliDeps): Promise<number> {
  try {
    if (args.backupNow) {
      const key = existingKey(args.keyFile)
      const link = await linkFor(args, false, d.fetchImpl)
      const s = await runBackup({ dataDir: args.dataDir, key: backupKey(key), appVersion: appVersion(d.repoRoot), link: () => link, log: d.out, ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}) })
      if (s.localFile) d.out(`  fichier   ${s.localFile}`)
      return s.ok && s.cloud !== 'failed' ? 0 : 1
    }
    if (args.listBackups) {
      const dir = path.join(args.dataDir, LOCAL_DIR)
      const local = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.atb')).sort().reverse() : []
      d.out(`Sur cet ordinateur (${dir}) :`)
      if (local.length === 0) d.out('  aucune')
      for (const n of local) d.out(`  ${n}  ${mb(statSync(path.join(dir, n)).size)}`)
      const link = await linkFor(args, false, d.fetchImpl)
      if (!link) {
        d.out('Atelier Cloud : machine non reliée.')
        return 0
      }
      const all = await listCloudBackups(link, d.fetchImpl)
      d.out(`Sur Atelier Cloud (équipe ${link.teamId}, gardées 14 jours, la plus récente toujours) :`)
      if (all.length === 0) d.out('  aucune')
      for (const b of all) d.out(`  ${b.id}  ${b.createdAt}  ${mb(b.size)}  machine ${b.machineId}`)
      return 0
    }
    if (args.restore !== null) {
      const key = backupKey(existingKey(args.keyFile))
      let bytes: Buffer
      let from: string
      if (existsSync(args.restore) && statSync(args.restore).isFile()) {
        bytes = readFileSync(args.restore)
        from = path.resolve(args.restore)
      } else if (args.restore === 'latest' || /^bkp_/.test(args.restore)) {
        const link = await linkFor(args, true, d.fetchImpl)
        if (!link) throw new BackupError('NO_SOURCE', 'Pas de lien avec Atelier Cloud dans ce dossier : inscris la machine (fichier d’inscription, --enrol-file) ou donne un fichier .atb.')
        const got = await downloadCloudBackup(link, args.restore, d.fetchImpl)
        bytes = got.bytes
        from = `Atelier Cloud ${got.backup.id} (${got.backup.createdAt})`
      } else {
        throw new BackupError('NO_SOURCE', `Source inconnue : ${args.restore} (latest, bkp_… ou un fichier .atb).`)
      }
      const r = restoreBackup({ bytes, key, dataDir: args.dataDir })
      d.out(`Restauré depuis ${from}`)
      d.out(`  faite le ${r.manifest.createdAt} sur ${r.manifest.host} (Atelier ${r.manifest.appVersion}, schéma ${r.manifest.schemaVersion})`)
      d.out(`  dans      ${args.dataDir}`)
      d.out(`  contenu   ${r.agents} agents, ${r.tasks} tâches dans la file, ${r.goals} objectifs, ${r.channels} chaînes, ${r.manifest.files.length - 1} fichiers d’équipe`)
      if (r.manifest.skipped.length) d.out(`  absents   ${r.manifest.skipped.map((s) => `${s.path} (${mb(s.size)})`).join(', ')} : trop gros pour une sauvegarde`)
      d.out('Démarre le cerveau sur ce dossier. Les comptes Claude des agents se reconnectent sur cette machine (Ajouter mon compte).')
      return 0
    }
    return 2
  } catch (err) {
    d.out(`Échec : ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}
