// Command line and environment of `npm run brain:headless` (docs/BRAIN-HEADLESS.md).
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_MAX_BODY_BYTES } from './server'
import { MSG as CLOUD_MSG, normaliseBaseUrl } from '../cloud/session'
import { defaultKeyFile } from './cipher'
import { DEFAULT_ENROL_FILE } from './cloud-link'
import { DEFAULT_BACKUP_AT, parseBackupAt, type BackupAt } from './backup-schedule'

export const DEFAULT_PORT = 8790
export const DEFAULT_HOST = '127.0.0.1'

export interface HeadlessArgs {
  dataDir: string
  keyFile: string
  host: string
  port: number
  origins: string[]
  maxBodyBytes: number
  rotateToken: boolean
  /** Start the MCP bridge so Claude Code agents get Atelier's tools (default on; `--no-mcp` turns it off). */
  mcp: boolean
  /** `--cloud-enrol`: link to Atelier Cloud (enrolment file or stored credential) or refuse to start. */
  cloudEnrol: boolean
  /** The enrolment file cloud-init writes (default /etc/atelier/enrol). */
  enrolFile: string
  /** The Atelier Cloud link at all (`--no-cloud` / ATELIER_CLOUD=off turn it off). */
  cloud: boolean
  /** Nightly backups (default on; `--no-backup` / ATELIER_BACKUP=off turn them off) and their local time. */
  backup: boolean
  backupAt: BackupAt
  /** Offline commands (docs/BRAIN-HEADLESS.md §10): a backup now, the list of backups, a restore into --data. */
  backupNow: boolean
  listBackups: boolean
  /** `latest`, a backup id (`bkp_…`) of the team on Atelier Cloud, or an archive file. */
  restore: string | null
  /** `--clean-data` (rendu-menage): report what the render leftovers hold and what would go; `--apply` deletes it. `--budget-gb` caps the re-creatable caches. */
  cleanData: boolean
  cleanApply: boolean
  budgetGb: number | null
  /** `--token-file`: a test team's brain key (record 0066) instead of a device login; null = none. */
  tokenFile: string | null
  /** `--cloud-url`: the Atelier Cloud this brain signs in to (else the one set before, else the local development Cloud). */
  cloudUrl: string | null
  help: boolean
}

export class ConfigError extends Error {}

/** Default data folder: $XDG_DATA_HOME/atelier-brain, else ~/.local/share/atelier-brain. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const base = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local', 'share')
  return path.join(base, 'atelier-brain')
}

/** An exact web origin (scheme://host[:port]); '*' and paths are refused. */
export function parseOrigin(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new ConfigError(`Origine invalide : ${raw} (exemple : http://localhost:5180)`)
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== raw.trim().replace(/\/$/, '')) {
    throw new ConfigError(`Origine invalide : ${raw} (exemple : http://localhost:5180, sans chemin)`)
  }
  return u.origin
}

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(host)
}

export function parseHeadlessArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): HeadlessArgs {
  const out: HeadlessArgs = {
    dataDir: env.ATELIER_DATA_DIR || defaultDataDir(env),
    keyFile: env.ATELIER_KEY_FILE || defaultKeyFile(env),
    host: env.ATELIER_BRAIN_HOST || DEFAULT_HOST,
    port: env.ATELIER_BRAIN_PORT ? Number(env.ATELIER_BRAIN_PORT) : DEFAULT_PORT,
    origins: (env.ATELIER_BRAIN_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    rotateToken: false,
    mcp: true,
    cloudEnrol: false,
    enrolFile: env.ATELIER_ENROL_FILE || DEFAULT_ENROL_FILE,
    cloud: env.ATELIER_CLOUD !== 'off',
    backup: env.ATELIER_BACKUP !== 'off',
    backupAt: DEFAULT_BACKUP_AT,
    backupNow: false,
    listBackups: false,
    restore: null,
    cleanData: false,
    cleanApply: false,
    budgetGb: null,
    tokenFile: env.ATELIER_TEST_TOKEN_FILE || null,
    cloudUrl: env.ATELIER_CLOUD_URL || null,
    help: false
  }
  const at = (raw: string): BackupAt => {
    const v = parseBackupAt(raw)
    if (!v) throw new ConfigError(`--backup-at : une heure HH:MM (reçu ${raw})`)
    return v
  }
  if (env.ATELIER_BACKUP_AT) out.backupAt = at(env.ATELIER_BACKUP_AT)
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new ConfigError(`${flag} attend une valeur`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--host') out.host = value(i++, a)
    else if (a === '--port') out.port = Number(value(i++, a))
    else if (a === '--data') out.dataDir = value(i++, a)
    else if (a === '--key-file') out.keyFile = value(i++, a)
    else if (a === '--origin') out.origins.push(value(i++, a))
    else if (a === '--max-body-mb') out.maxBodyBytes = Math.round(Number(value(i++, a)) * 1024 * 1024)
    else if (a === '--rotate-token') out.rotateToken = true
    else if (a === '--no-mcp') out.mcp = false
    else if (a === '--cloud-enrol') out.cloudEnrol = true
    else if (a === '--enrol-file') out.enrolFile = value(i++, a)
    else if (a === '--no-cloud') out.cloud = false
    else if (a === '--no-backup') out.backup = false
    else if (a === '--backup-at') out.backupAt = at(value(i++, a))
    else if (a === '--backup-now') out.backupNow = true
    else if (a === '--list-backups') out.listBackups = true
    else if (a === '--restore') out.restore = value(i++, a)
    else if (a === '--clean-data') out.cleanData = true
    else if (a === '--apply') out.cleanApply = true
    else if (a === '--budget-gb') out.budgetGb = Number(value(i++, a))
    else if (a === '--token-file') out.tokenFile = value(i++, a)
    else if (a === '--cloud-url') out.cloudUrl = value(i++, a)
    else if (a === '--help' || a === '-h') out.help = true
    else throw new ConfigError(`Option inconnue : ${a} (voir --help)`)
  }
  if (out.cleanApply && !out.cleanData) throw new ConfigError('--apply ne va qu’avec --clean-data')
  if (out.budgetGb !== null && (!Number.isFinite(out.budgetGb) || out.budgetGb < 0)) throw new ConfigError('--budget-gb : un nombre positif de Go')
  if (out.cleanData && (out.rotateToken || out.backupNow || out.listBackups || out.restore !== null)) throw new ConfigError('--clean-data se lance seul')
  if (out.tokenFile !== null && !out.cloud) throw new ConfigError('--token-file et --no-cloud sont contradictoires')
  if (out.cloudEnrol && !out.cloud) throw new ConfigError('--cloud-enrol et --no-cloud sont contradictoires')
  if ([out.rotateToken, out.backupNow, out.listBackups, out.restore !== null].filter(Boolean).length > 1) {
    throw new ConfigError('--rotate-token, --backup-now, --list-backups et --restore : une seule commande à la fois')
  }
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) throw new ConfigError('--port : un nombre de 0 à 65535')
  if (!Number.isFinite(out.maxBodyBytes) || out.maxBodyBytes < 1024) throw new ConfigError('--max-body-mb : un nombre positif')
  out.origins = [...new Set(out.origins.map(parseOrigin))]
  out.dataDir = path.resolve(out.dataDir)
  out.keyFile = path.resolve(out.keyFile)
  out.enrolFile = path.resolve(out.enrolFile)
  if (out.tokenFile !== null) out.tokenFile = path.resolve(out.tokenFile)
  if (out.cloudUrl !== null) {
    const url = normaliseBaseUrl(out.cloudUrl)
    if (!url) throw new ConfigError(`--cloud-url : ${CLOUD_MSG.badUrl}`)
    out.cloudUrl = url
  }
  return out
}

export const HELP = `npm run brain:headless -- [options]   le cerveau d'Atelier sans écran (docs/BRAIN-HEADLESS.md)

  --data <dossier>      données (atelier.db, production, jeton) ; env ATELIER_DATA_DIR
                        (défaut : ~/.local/share/atelier-brain)
  --key-file <fichier>  clé de la machine qui chiffre les secrets ; env ATELIER_KEY_FILE
                        (défaut : ~/.config/atelier-brain/machine.key, jamais dans un dépôt git)
  --host <adresse>      défaut 127.0.0.1 (on y arrive par un tunnel SSH) ; env ATELIER_BRAIN_HOST
  --port <n>            défaut ${DEFAULT_PORT} (0 = au hasard) ; env ATELIER_BRAIN_PORT
  --origin <origine>    origine web autorisée (CORS), répétable ; env ATELIER_BRAIN_ORIGINS (virgules)
  --max-body-mb <n>     taille maximale d'une requête (défaut 32)
  --rotate-token        cerveau ARRÊTÉ : fabrique un nouveau jeton (l'ancien ne marche plus), l'affiche une
                        fois et s'arrête ; refusé tant que le service tient son port
  --no-mcp              sans le pont MCP (les agents Claude Code n'ont pas les outils d'Atelier)
  --cloud-enrol         se relie à Atelier Cloud (inscription avec le fichier, puis relais sortant) ; refuse de
                        démarrer s'il n'y a ni fichier d'inscription ni identifiant enregistré
  --enrol-file <f>      le fichier d'inscription ; env ATELIER_ENROL_FILE (défaut : /etc/atelier/enrol)
  --no-cloud            sans Atelier Cloud, même si un fichier d'inscription existe ; env ATELIER_CLOUD=off
  --token-file <f>      cerveau de TEST : se connecte à Atelier Cloud avec la clé de l'équipe de test (admin test-team
                        create), sans connexion dans un navigateur ; env ATELIER_TEST_TOKEN_FILE
  --cloud-url <url>     l'adresse d'Atelier Cloud (https://…) ; env ATELIER_CLOUD_URL
  --backup-at <HH:MM>   heure de la sauvegarde de chaque nuit (défaut 03:30, heure locale) ; env ATELIER_BACKUP_AT
  --no-backup           sans sauvegarde de nuit ; env ATELIER_BACKUP=off

  Commandes (le cerveau peut tourner pendant les deux premières) :
  --backup-now          une sauvegarde tout de suite (gardée ici, et envoyée sur Atelier Cloud si la machine est reliée)
  --list-backups        les sauvegardes de cet ordinateur et celles de l'équipe sur Atelier Cloud
  --clean-data          le ménage des rendus : montre ce que les restes de fabrication pèsent et ce qui partirait
                        (essai à blanc : rien n’est supprimé) ; --apply supprime, --budget-gb <n> fixe le plafond des
                        fichiers refaisables (défaut : un quart de la place libre, entre 2 et 20 Go). Ne touche jamais
                        aux vidéos finies ni à ce qui a coûté de l’argent.
  --restore <source>    restaure dans --data (un dossier SANS base) : latest, un identifiant bkp_… (Atelier Cloud ;
                        avec --enrol-file si ce dossier n'a pas encore d'identifiant) ou un fichier .atb ;
                        il faut la clé de la machine qui a fait la sauvegarde (--key-file)
`
