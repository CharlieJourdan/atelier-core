// Builder (bêta) sessions (PLAN-V2-PRODUCTION §2.5): a chat with the Builder on the user's Claude Code and a pipeline
// draft that only changes when the reply carries a VALID ```atelier-pipeline``` block. Saving into the library needs a
// valid draft and the user's click.
//
// Hand-off to lot P10: today each turn is one `ctx.ask` with the catalogue and the draft in the system prompt. P10 runs a
// hidden Claude Code session per Builder session in `<userData>/builder/<session>/` (pipeline.json, style.json,
// analysis.json, a generated catalog.md, our CLAUDE.md and skills in .claude/skills/), with `--setting-sources project`,
// path-scoped read/write permissions, no Bash, no web, deny-by-default; plus the MCP "Builder" server (catalog_list,
// pipeline_validate, pipeline_estimate, pipeline_preview) on the v1 token bridge, and `custom.claude` nodes. The app
// keeps re-reading and validating the draft after each turn exactly as `applyReply` does here.
import type { Db } from '../db'
import { nowIso } from '../db'
import type { BuilderDetail, BuilderMessage, BuilderSummary, PipelineCostReport, PipelineProblem } from '../../shared/analysis'
import { checkPipeline, costReport } from './catalog'
import { cleanText, isId } from './library'
import { extractBlock, PIPELINE_TAG } from './prompts'

interface SessionRow {
  id: number
  title: string
  pipeline_id: number | null
  analysis_id: number | null
  draft_json: string
  previous_draft_json: string | null
  errors_json: string
  estimate_json: string
  example: number
  updated_at: string
}

export class BuilderStore {
  constructor(private readonly db: Db) {}

  private raw(id: number): SessionRow {
    if (!isId(id)) throw new Error('Session du Builder inconnue.')
    const r = this.db.prepare('SELECT * FROM builder_sessions WHERE id = ?').get(id) as unknown as SessionRow | undefined
    if (!r) throw new Error('Session du Builder inconnue.')
    return r
  }

  private summary(r: SessionRow): BuilderSummary {
    return {
      id: r.id,
      title: r.title,
      pipelineId: r.pipeline_id,
      analysisId: r.analysis_id,
      valid: (JSON.parse(r.errors_json) as PipelineProblem[]).length === 0,
      example: r.example === 1,
      updatedAt: r.updated_at
    }
  }

  list(): BuilderSummary[] {
    return (this.db.prepare('SELECT * FROM builder_sessions ORDER BY updated_at DESC, id DESC').all() as unknown as SessionRow[]).map((r) => this.summary(r))
  }

  /** A new session starting from a (valid) document. */
  async create(input: { title: string; draftJson: string; pipelineId?: number | null; analysisId?: number | null; example?: boolean }): Promise<number> {
    const check = checkPipeline(input.draftJson)
    if (!check.ok || !check.plan) throw new Error('Le point de départ du Builder doit être un pipeline valide.')
    const cost = await costReport(check.plan)
    const at = nowIso()
    return Number(
      this.db
        .prepare(
          `INSERT INTO builder_sessions (title, pipeline_id, analysis_id, draft_json, errors_json, estimate_json, example, created_at, updated_at)
           VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)`
        )
        .run(cleanText(input.title, 'Titre', 120), input.pipelineId ?? null, input.analysisId ?? null, check.json, JSON.stringify(cost), input.example ? 1 : 0, at, at)
        .lastInsertRowid
    )
  }

  draft(id: number): string {
    return this.raw(id).draft_json
  }

  addMessage(id: number, author: 'user' | 'builder', body: string, outcome: BuilderMessage['outcome'] = 'none', problems: PipelineProblem[] = []): void {
    this.db
      .prepare('INSERT INTO builder_messages (session_id, author, body, outcome, errors_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, author, body, outcome, JSON.stringify(problems), nowIso())
    this.db.prepare('UPDATE builder_sessions SET updated_at = ? WHERE id = ?').run(nowIso(), id)
  }

  /**
   * Reads a Builder reply: a valid block replaces the draft (the old one is kept for the diff); an invalid one is
   * reported and the draft stays. Returns the text to show (block stripped).
   */
  async applyReply(id: number, reply: string): Promise<{ shown: string; outcome: BuilderMessage['outcome']; problems: PipelineProblem[] }> {
    const r = this.raw(id)
    const { shown, block } = extractBlock(reply, PIPELINE_TAG)
    if (block === null) return { shown, outcome: 'none', problems: [] }
    const check = checkPipeline(block)
    if (!check.ok || !check.plan) {
      const problems = check.ok ? [] : check.problems
      this.db.prepare('UPDATE builder_sessions SET errors_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(problems), nowIso(), id)
      return { shown, outcome: 'invalid', problems }
    }
    const cost = await costReport(check.plan)
    const changed = check.json !== r.draft_json
    this.db
      .prepare('UPDATE builder_sessions SET draft_json = ?, previous_draft_json = ?, errors_json = ?, estimate_json = ?, updated_at = ? WHERE id = ?')
      .run(check.json, changed ? r.draft_json : r.previous_draft_json, '[]', JSON.stringify(cost), nowIso(), id)
    return { shown, outcome: 'valid', problems: [] }
  }

  setPipeline(id: number, pipelineId: number): void {
    this.db.prepare('UPDATE builder_sessions SET pipeline_id = ?, updated_at = ? WHERE id = ?').run(pipelineId, nowIso(), id)
  }

  detail(id: number): BuilderDetail {
    const r = this.raw(id)
    const msgs = this.db
      .prepare('SELECT id, author, body, outcome, errors_json, created_at FROM builder_messages WHERE session_id = ? ORDER BY id')
      .all(id) as { id: number; author: 'user' | 'builder'; body: string; outcome: BuilderMessage['outcome']; errors_json: string; created_at: string }[]
    return {
      ...this.summary(r),
      draftJson: r.draft_json,
      previousDraftJson: r.previous_draft_json,
      problems: JSON.parse(r.errors_json) as PipelineProblem[],
      cost: JSON.parse(r.estimate_json) as PipelineCostReport | null,
      messages: msgs.map((m) => ({ id: m.id, author: m.author, body: m.body, outcome: m.outcome, problems: JSON.parse(m.errors_json) as PipelineProblem[], createdAt: m.created_at }))
    }
  }

  delete(id: number): void {
    this.raw(id)
    this.db.prepare('DELETE FROM builder_sessions WHERE id = ?').run(id)
  }
}
