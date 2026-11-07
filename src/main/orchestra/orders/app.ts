// The orders on the app's real production (equipe-3-chaines): the channel's own pipeline made to read the owner's script, a
// video and its project with the script word for word, the quote in dollars, the launch, and « refaire ces étapes » on the
// same video (a new seed for the voice / the pictures / the render: what a real error points to, the rest from the cache).
import type { Db } from '../../db'
import type { ProjectStore, RecipeStore } from '../../production/recipes'
import type { ProductionRuns } from '../../production/runs/service'
import { countWords } from '../../../engine/text/script'
import { wpmMeasured } from '../../../engine/text/lint'
import { compileRecipe } from '../../../engine/technologies/compile'
import type { BlockingError, OrderProduction } from '.'

export interface AppOrderDeps {
  db: Db
  recipes: RecipeStore
  projects: () => ProjectStore
  runs: () => ProductionRuns
  usdPerCredit: () => number
  now?: () => Date
}

export const IMPORT_SUFFIX = ' · script importé'

/** The nodes a step makes (by technology): the voice, the pictures chosen for the shots, the render. */
const STEP_NODES: Record<BlockingError['step'], readonly string[]> = {
  voice: ['voice.tts@'],
  pictures: ['visuals.fulfil@'],
  render: ['render.assemble@']
}

/** The length a pasted script takes when said (pure): its words at the language's measured pace, in half minutes. */
export function scriptMinutes(script: string, language: string): number {
  const words = countWords(script.replace(/\[[^\]]*\]/g, ' '))
  return Math.min(30, Math.max(0.5, Math.round((words / wpmMeasured(language)) * 2) / 2))
}

export function appOrderProduction(d: AppOrderDeps): OrderProduction {
  const now = d.now ?? (() => new Date())
  const channelRecipe = (channelId: number): number => {
    const uses = d.recipes.channel(channelId).recipes
    const id = uses['avatar-long'] ?? uses.documentaire ?? uses.autre ?? uses.short
    if (id === undefined) throw new Error('Cette chaîne n’a pas encore de pipeline : choisis-en une dans Production › Pipelines (« Utiliser pour cette chaîne »).')
    return id
  }
  const takesScript = (recipeId: number, channelId: number): boolean => {
    const { doc, number } = d.recipes.doc(recipeId)
    const c = compileRecipe(doc, d.recipes.registry, { channel: d.recipes.production(channelId), id: `recette-${recipeId}`, version: number, styles: d.recipes.styleDocs(doc) })
    return c.ok && c.pipeline.inputs.some((i) => i.id === 'script')
  }
  const languageOf = (recipeId: number): string => d.recipes.doc(recipeId).doc.language ?? 'fr'
  return {
    importRecipe(channelId) {
      const own = channelRecipe(channelId)
      if (takesScript(own, channelId)) return own
      const { doc } = d.recipes.doc(own)
      const name = `${doc.name.slice(0, 120 - IMPORT_SUFFIX.length)}${IMPORT_SUFFIX}`
      const made = d.db.prepare('SELECT id FROM recipes WHERE name = ? AND archived_at IS NULL ORDER BY id DESC').all(name) as { id: number }[]
      // the copy made for an earlier order, when it is still the same pipeline with its script imported
      const same = made.find((m) => {
        const c = d.recipes.doc(m.id).doc
        return c.base === doc.base && JSON.stringify(c.bricks.filter((b) => !b.tech.startsWith('script.'))) === JSON.stringify(doc.bricks.filter((b) => !b.tech.startsWith('script.')))
      })
      if (same && takesScript(same.id, channelId)) return same.id
      const saved = d.recipes.save({ doc: { ...doc, name, options: { ...doc.options, script: 'import' } }, note: `Copie de « ${doc.name} » qui lit le script de Charlie (commande de vidéos)` })
      if (!takesScript(saved.id, channelId)) throw new Error(`La pipeline « ${doc.name} » ne sait pas lire un script importé.`)
      return saved.id
    },
    prepare(o) {
      const t = now().toISOString()
      const v = d.db.prepare("INSERT INTO videos (channel_id, title, brief, status, created_at, updated_at) VALUES (?, ?, ?, 'idea', ?, ?)").run(o.channelId, o.title, o.title, t, t)
      const videoId = Number(v.lastInsertRowid)
      const projects = d.projects()
      const p = projects.create({ recipeId: o.recipeId, channelId: o.channelId, title: o.title, idea: o.title, videoId, adjustments: { minutes: scriptMinutes(o.script, languageOf(o.recipeId)) } })
      projects.setScript(p.id, o.script)
      return { videoId, projectId: p.id }
    },
    async quoteUsd(projectId, real) {
      const q = await d.projects().quote(projectId, real ? { real: true } : {})
      const mode = q.modes[q.budgetMode ?? 'usage_max'] ?? Object.values(q.modes)[0]
      return (mode?.totalCredits ?? 0) * d.usdPerCredit()
    },
    async launch(projectId, real) {
      const p = await d.projects().run(projectId, real ? { real: true } : {})
      if (p.runId === null) throw new Error('La fabrication n’a pas démarré.')
      return p.runId
    },
    async remake(runId, steps, maxUsd) {
      const run = d.runs().get(runId)
      const prefixes = steps.flatMap((s) => STEP_NODES[s])
      const nodes = run.nodes.filter((n) => prefixes.some((p) => n.type.startsWith(p))).map((n) => n.nodeId)
      const ids = nodes.length > 0 ? nodes : run.nodes.filter((n) => n.type.startsWith('render.assemble@')).map((n) => n.nodeId)
      return (await d.runs().remake(runId, ids, maxUsd === null ? undefined : maxUsd / d.usdPerCredit())).id
    },
    approve(runId, nodeId) {
      d.runs().approve(runId, nodeId)
    },
    run(runId) {
      try {
        const r = d.runs().get(runId)
        return { status: r.status, error: r.error, videoId: r.videoId, waitingNodes: r.waitingNodes, spentUsd: r.spentCredits * d.usdPerCredit() }
      } catch {
        return null
      }
    }
  }
}
