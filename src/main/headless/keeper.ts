// The keeper of the team computer's brain (docs/BRAIN-HEADLESS.md §10): a small parent process that runs the brain and
// starts it again when it dies (a crash, a kill, an out-of-memory), with a growing delay (1 s … 60 s) so a brain that
// cannot start does not spin; the delay resets once a brain has run 10 minutes. It does not restart a brain that stopped
// on purpose (exit 0: SIGTERM / SIGINT), nor one that cannot start for a reason a retry will not fix (2 bad options,
// 3 port taken: a brain already runs). The restart count reaches the brain (ATELIER_BRAIN_RESTARTS) for « Ordinateur
// d'équipe ». The same on Windows, macOS and Linux; under systemd it adds nothing harmful to Restart=on-failure.

export interface BrainChild {
  once(event: 'exit', fn: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export interface KeeperOptions {
  /** Starts one brain with these extra environment variables. */
  spawnBrain: (env: Record<string, string>) => BrainChild
  log?: (line: string) => void
  /** Waits before each restart, the last one repeated. */
  delaysMs?: readonly number[]
  /** A brain that ran this long resets the delays. */
  stableMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export const DEFAULT_DELAYS_MS = [1000, 2000, 5000, 15_000, 30_000, 60_000] as const
export const STABLE_MS = 10 * 60_000
/** The brain's exit codes that a restart would not fix. */
export const NO_RESTART_CODES = new Set([2, 3])

export class Keeper {
  private readonly o: KeeperOptions
  private child: BrainChild | null = null
  private stopping = false
  private wake: (() => void) | null = null
  /** Restarts after a crash so far. */
  restarts = 0

  constructor(o: KeeperOptions) {
    this.o = o
  }

  private log(line: string): void {
    ;(this.o.log ?? (() => undefined))(line)
  }

  private now(): number {
    return (this.o.now ?? Date.now)()
  }

  private wait(ms: number): Promise<void> {
    if (this.o.sleep) return this.o.sleep(ms)
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms)
      this.wake = () => {
        clearTimeout(t)
        resolve()
      }
    })
  }

  /** Runs brains until one stops on purpose or cannot start; resolves with the exit code the keeper should end with. */
  async run(): Promise<number> {
    const delays = this.o.delaysMs ?? DEFAULT_DELAYS_MS
    let attempt = 0
    while (!this.stopping) {
      const started = this.now()
      const child = this.o.spawnBrain({ ATELIER_BRAIN_RESTARTS: String(this.restarts) })
      this.child = child
      const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once('exit', (c, s) => resolve({ code: c, signal: s })))
      this.child = null
      if (this.stopping || code === 0) {
        this.log('Gardien : le cerveau s’est arrêté normalement.')
        return 0
      }
      if (code !== null && NO_RESTART_CODES.has(code)) {
        this.log(`Gardien : le cerveau ne peut pas démarrer (code ${code}) ; pas de nouvel essai.`)
        return code
      }
      if (this.now() - started >= (this.o.stableMs ?? STABLE_MS)) attempt = 0
      const delay = delays[Math.min(attempt, delays.length - 1)] ?? 60_000
      attempt++
      this.restarts++
      const why = signal ? `signal ${signal}` : `code ${String(code)}`
      this.log(`Gardien : le cerveau s’est arrêté (${why}) après ${Math.round((this.now() - started) / 1000)} s ; redémarrage n°${this.restarts} dans ${Math.round(delay / 1000)} s.`)
      await this.wait(delay)
    }
    return 0
  }

  /** Stops for good: the running brain gets SIGTERM (it closes cleanly), no restart follows. */
  stop(): void {
    this.stopping = true
    this.wake?.()
    this.child?.kill('SIGTERM')
  }
}

/** The keeper's own options (the rest goes to the brain): `--keeper-log <dir>` writes the output to a dated file there,
 *  `--keeper-pid <file>` records the keeper's pid as `{"brain": pid}` (what scripts/beta/team-pc.ps1 stops). */
export function splitKeeperArgs(argv: readonly string[]): { logDir: string | null; pidFile: string | null; brain: string[] } {
  let logDir: string | null = null
  let pidFile: string | null = null
  const brain: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if ((a === '--keeper-log' || a === '--keeper-pid') && argv[i + 1] !== undefined) {
      if (a === '--keeper-log') logDir = argv[++i] as string
      else pidFile = argv[++i] as string
    } else brain.push(a)
  }
  return { logDir, pidFile, brain }
}
