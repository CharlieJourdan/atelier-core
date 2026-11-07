// Where a clone's artefacts live (decision 0095): `<dataDir>/clones/<id>/p<N>-<name>.json` (+ evidence folders), a
// decisions log (`decisions.jsonl`) and a spend ledger (`spend.jsonl`). The orchestrator resumes from what is saved.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import type { Spend } from '../../../shared/clone'

export interface Folder { abs: string; rel: string }

export interface DecisionEntry { at: string; phase: string; decision: string; why: string }

export class CloneStore {
  readonly dir: string
  constructor(dataDir: string, readonly cloneId: string) {
    if (!/^[a-z0-9-]+$/i.test(cloneId)) throw new Error(`bad clone id ${cloneId}`)
    this.dir = path.join(dataDir, 'clones', cloneId)
    mkdirSync(this.dir, { recursive: true })
  }

  /** Absolute path of a file of this clone (relative names stay relative in artefacts). */
  file(rel: string): string { return path.join(this.dir, rel) }

  /** A sub-folder for evidence (frames, renders) of a phase or round, created. Services write into `abs` and return
   *  paths under `rel` (artefacts keep paths relative to the clone folder). */
  folder(rel: string): Folder { mkdirSync(this.file(rel), { recursive: true }); return { abs: this.file(rel), rel } }

  has(name: string): boolean { return existsSync(this.file(name)) }

  save(name: string, value: unknown): void {
    writeFileSync(this.file(name), JSON.stringify(value, null, 2) + '\n', 'utf8')
  }

  load<T>(name: string, schema: z.ZodType<T>): T | null {
    if (!this.has(name)) return null
    return schema.parse(JSON.parse(readFileSync(this.file(name), 'utf8')))
  }

  /** Names of saved artefacts matching a prefix, sorted (`p6-round-` → rounds). */
  list(prefix: string): string[] {
    return readdirSync(this.dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort()
  }

  decide(entry: DecisionEntry): void { appendFileSync(this.file('decisions.jsonl'), JSON.stringify(entry) + '\n', 'utf8') }

  decisions(): DecisionEntry[] { return this.lines<DecisionEntry>('decisions.jsonl') }

  spend(s: Spend): void { appendFileSync(this.file('spend.jsonl'), JSON.stringify(s) + '\n', 'utf8') }

  spent(): number { return this.lines<Spend>('spend.jsonl').reduce((t, s) => t + s.usd, 0) }

  private lines<T>(name: string): T[] {
    if (!this.has(name)) return []
    return readFileSync(this.file(name), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as T)
  }
}

/** Artefact file names, one per phase (rounds and definition versions are numbered). */
export const ARTEFACTS = {
  brief: 'p0-brief.json',
  corpus: 'p1-corpus.json',
  analysis: (videoId: string) => `p2-analysis-${videoId}.json`,
  synthesis: 'p2-synthesis.json',
  feasibility: 'p3-feasibility.json',
  definition: 'p4-style-definition.json',
  definitionVersion: (v: number) => `p4-style-definition.v${v}.json`,
  plan: 'p5-pipeline-plan.json',
  round: (n: number) => `p6-round-${String(n).padStart(2, '0')}.json`,
  example: 'p9-example.json',
  report: 'p10-report.json'
} as const
