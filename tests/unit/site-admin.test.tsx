// Founder console: login, the eight pages, and the pure logic behind them (fixture economics, blueprint validation, diff).
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { Admin, ADMIN_PAGES } from '../../web/src/admin/Admin'
import { diffLines, collapseDiff } from '../../web/src/admin/diff'
import {
  HISTORY,
  PUBLISHED_V3,
  makeDraftV4,
  parseBlueprintText,
  pipelineCredits,
  stringify,
  validateBlueprint
} from '../../web/src/admin/blueprint'
import {
  ACTIVE_USERS,
  COST_LINES,
  COST_TOTAL,
  GROSS_MARGIN_EUR,
  JOBS,
  MACHINES,
  MRR,
  MRR_SERIES,
  PROVIDERS,
  REVENUE_MONTH,
  USERS,
  economics,
  listMargin,
  planEconomics
} from '../../web/src/admin/data'
import { setAdmin } from '../../web/src/auth'
import { PLANS } from '../../web/src/plans'
import { Router } from '../../web/src/router'

const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

const render = (path: string): string =>
  renderToStaticMarkup(
    <Router initialPath={path}>
      <Admin />
    </Router>
  )

describe('admin login', () => {
  beforeEach(() => setAdmin(false))

  it('shows the fake login before anything else', () => {
    const t = textOf(render('/admin'))
    expect(t).toContain('Console fondateur')
    expect(t).toContain('cette connexion est fictive')
    expect(t).not.toContain('Utilisateurs et CRM')
  })
})

describe('admin pages', () => {
  beforeEach(() => setAdmin(true))

  it('has a left nav with the eight pages', () => {
    const html = render('/admin')
    for (const p of ADMIN_PAGES) expect(textOf(html)).toContain(p.label)
    expect(ADMIN_PAGES).toHaveLength(8)
    expect(html).toContain('aria-current="page"')
  })

  it('overview: MRR, active users, churn, gross margin and the cost categories', () => {
    const t = textOf(render('/admin'))
    for (const label of ['MRR', 'Utilisateurs actifs', 'Churn mensuel', 'Marge brute', 'Coûts du mois par catégorie']) expect(t).toContain(label)
    for (const c of ['Machines d’équipe', 'API voix', 'API images', 'API vidéo', 'Relais LLM et yeux', 'Stockage', 'Frais Stripe']) expect(t).toContain(c)
    const html = render('/admin')
    expect(html).toContain('<svg')
    expect(html).toContain('role="img"')
  })

  it('users: the CRM table with plan, MRR, channels, videos, credits, margin, status', () => {
    const html = render('/admin/utilisateurs')
    const t = textOf(html)
    for (const h of ['Utilisateur', 'Plan', 'MRR', 'Chaînes', 'Vidéos / mois', 'Crédits', 'Marge', 'Statut', 'Dernière activité']) expect(t).toContain(h)
    expect((html.match(/<tr[^>]*tabindex="0"/g) ?? []).length).toBe(USERS.length)
    for (const s of ['Essai', 'Actif', 'À risque']) expect(t).toContain(s)
  })

  it('machines: Hetzner types, states, actions and the provisioning log', () => {
    const t = textOf(render('/admin/machines'))
    expect(t).toContain('Hetzner')
    expect(t).toContain('CX33')
    expect(t).toContain('Hiberner')
    expect(t).toContain('Redémarrer')
    expect(t).toContain('nouvel utilisateur → machine commandée → Claude Code installé → prêt en 3 min 12 s')
    expect(t).toContain('Préparation')
  })

  it('production: running, queued and failed videos with provider and cost', () => {
    const t = textOf(render('/admin/production'))
    for (const s of ['En cours', 'En attente', 'Erreur', 'MiniMax speech-2.8-hd', 'Relancer']) expect(t).toContain(s)
    expect(JOBS.some((j) => j.state === 'error')).toBe(true)
  })

  it('costs: margin per plan, spend per provider and the editable markup', () => {
    const html = render('/admin/couts')
    const t = textOf(html)
    for (const s of ['Marge par plan', 'Dépenses par fournisseur', 'Multiplicateur de crédits', 'Starter', 'Network']) expect(t).toContain(s)
    expect(html).toContain('type="number"')
  })

  it('blueprints: the form view, the draft v4 and the publish button', () => {
    const t = textOf(render('/admin/blueprints'))
    expect(t).toContain('Blueprints')
    expect(t).toContain('Publier v4 pour tous les espaces')
    expect(t).toContain('Brouillon v4')
    expect(t).toContain('Agent principal')
    expect(t).toContain('Formulaire')
    expect(t).toContain('JSON')
    expect(t).toContain('Versions')
  })

  it('providers: key status only, never a key value', () => {
    const html = render('/admin/fournisseurs')
    const t = textOf(html)
    expect(t).toContain('Définie')
    expect(t).toContain('Non définie')
    expect(t).toContain('ne s’affichent jamais')
    expect(html).not.toMatch(/sk-|api[_-]?key["']?\s*[:=]/i)
    expect(PROVIDERS.every((p) => typeof p.keySet === 'boolean')).toBe(true)
    expect(t).toContain('Prix unitaires')
  })
})

describe('fixture economics', () => {
  it('derives MRR, revenue and margin from the user list and the plan grid', () => {
    expect(USERS.length).toBeGreaterThan(30)
    expect(MRR).toBeGreaterThan(3000)
    expect(MRR_SERIES[MRR_SERIES.length - 1]).toBe(Math.round(MRR))
    expect(MRR_SERIES[0]).toBeLessThan(MRR_SERIES[11] ?? 0)
    expect(REVENUE_MONTH).toBeGreaterThanOrEqual(MRR)
    expect(COST_LINES.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(COST_TOTAL, 6)
    expect(GROSS_MARGIN_EUR).toBeCloseTo(REVENUE_MONTH - COST_TOTAL, 6)
    expect(ACTIVE_USERS).toBeGreaterThan(20)
  })

  it('reproduces the list margins of BUSINESS-INFRA §6.3 at 100 % credit use', () => {
    const expected: Record<string, number> = { starter: 46.1, creator: 49.5, studio: 49.9, agency: 47.7, network: 45.7 }
    for (const p of PLANS) expect(listMargin(p.id, 1.3)).toBeCloseTo(expected[p.id] ?? 0, 0)
  })

  it('a bigger credit multiplier raises margin', () => {
    const base = planEconomics(1.3).reduce((s, p) => s + p.margin, 0)
    const more = planEconomics(1.5).reduce((s, p) => s + p.margin, 0)
    expect(more).toBeGreaterThan(base)
  })

  it('trial accounts cost money and earn nothing', () => {
    const trial = USERS.find((u) => u.status === 'trial')
    expect(trial).toBeDefined()
    const e = economics(trial!)
    expect(e.revenue).toBe(0)
    expect(e.margin).toBeLessThan(0)
  })

  it('every account has machines of the right count and a Hetzner type', () => {
    for (const u of USERS) {
      const plan = PLANS.find((p) => p.id === u.plan)!
      expect(MACHINES.filter((m) => m.userId === u.id)).toHaveLength(plan.computers)
    }
    expect(MACHINES.some((m) => m.status === 'provisioning')).toBe(true)
  })
})

describe('blueprints logic', () => {
  it('the published v3 and the draft v4 are valid', () => {
    expect(validateBlueprint(PUBLISHED_V3)).toEqual([])
    expect(validateBlueprint(makeDraftV4())).toEqual([])
    expect(HISTORY[0]?.version).toBe(3)
    expect(PUBLISHED_V3.agents.length).toBeGreaterThanOrEqual(9)
  })

  it('round-trips through JSON text', () => {
    const r = parseBlueprintText(stringify(makeDraftV4()))
    expect(r.issues).toEqual([])
    expect(r.value?.version).toBe(4)
  })

  it('reports a syntax error with its line and column', () => {
    const r = parseBlueprintText('{\n  "version": 4,\n  "agents": [,]\n}')
    expect(r.value).toBeUndefined()
    expect(r.issues[0]?.message).toMatch(/ligne 3/)
  })

  it('reports the path of schema errors', () => {
    const bad = structuredClone(PUBLISHED_V3) as unknown as Record<string, unknown>
    const agents = bad.agents as Record<string, unknown>[]
    agents[0]!.tier = 'gigantic'
    agents[1]!.id = agents[0]!.id
    const pipelines = bad.pipelines as { nodes: Record<string, unknown>[] }[]
    pipelines[0]!.nodes[0]!.credits = -3
    const issues = validateBlueprint(bad)
    const paths = issues.map((i) => i.path)
    expect(paths).toContain('agents[0].tier')
    expect(paths).toContain('agents[1].id')
    expect(paths).toContain('pipelines[0].nodes[0].credits')
  })

  it('rejects empty agents and non-objects', () => {
    expect(validateBlueprint(null)).toHaveLength(1)
    expect(validateBlueprint({ version: 1, agents: [], pipelines: [] }).map((i) => i.path)).toEqual(['agents', 'pipelines'])
  })

  it('the draft differs from v3 by the three planned changes', () => {
    const lines = diffLines(stringify(PUBLISHED_V3), stringify(makeDraftV4()))
    const added = lines.filter((l) => l.kind === 'add').map((l) => l.text.trim())
    const removed = lines.filter((l) => l.kind === 'del').map((l) => l.text.trim())
    expect(added).toContain('"version": 4,')
    expect(removed).toContain('"version": 3,')
    expect(added).toContain('"id": "sous-titres",')
    expect(added).toContain('"tier": "balanced",')
    const doc = makeDraftV4().pipelines[0]!
    expect(pipelineCredits(doc)).toBe(pipelineCredits(PUBLISHED_V3.pipelines[0]!) + 6)
  })
})

describe('line diff', () => {
  it('marks added and removed lines and keeps the common ones', () => {
    const d = diffLines('a\nb\nc', 'a\nc\nd')
    expect(d.map((l) => `${l.kind}:${l.text}`)).toEqual(['same:a', 'del:b', 'same:c', 'add:d'])
  })

  it('has no change for identical texts, and collapses long unchanged runs', () => {
    expect(diffLines('x\ny', 'x\ny').every((l) => l.kind === 'same')).toBe(true)
    const long = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n')
    const collapsed = collapseDiff(diffLines(long, long.replace('l15', 'changed')), 2)
    expect(collapsed.some((l) => l.kind === 'gap')).toBe(true)
    expect(collapsed.length).toBeLessThan(14)
  })
})
