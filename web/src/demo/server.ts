// The in-browser fake of Atelier Cloud for the demo build (VITE_ATELIER_DEMO=1): cloud.ts hands it every call instead of
// fetch, so the demo never touches the network. It answers each route the site and the founder console use, from the
// invented fixtures of this folder; state lives in memory and resets on reload.
import { DEMO_ACCOUNT } from './mode'
import { adminMachines, blueprintState, machineAction, markPaid, overview, publishBlueprint, releaseAction, releaseList, teamKit, teamKits, teamMachines } from './console'
import { crmAction, crmDetail, crmList } from './crm'
import { financeDashboard, removeFixed, saveFinanceSettings, saveFixed } from './finance'

export interface DemoAnswer {
  status: number
  body: unknown
}

const ok = (body: unknown): DemoAnswer => ({ status: 200, body })
const fail = (status: number, code: string, message: string): DemoAnswer => ({ status, body: { error: { code, message } } })
const notFound = (): DemoAnswer => fail(404, 'not_found', 'Introuvable (démo)')

/** Who is signed in: the founder account by default; a signup or another address changes the name shown. */
const me = { name: DEMO_ACCOUNT.name as string, email: DEMO_ACCOUNT.email as string }
let session = 0
const tokens = (): { accessToken: string; refreshToken: string } => {
  session += 1
  return { accessToken: `demo-access-${session}`, refreshToken: `demo-refresh-${session}` }
}
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const nameOf = (email: string): string => (email === DEMO_ACCOUNT.email ? DEMO_ACCOUNT.name : (email.split('@')[0] ?? DEMO_ACCOUNT.name))

function auth(route: string, body: Record<string, unknown>): DemoAnswer | null {
  switch (route) {
    case 'POST /v1/auth/login': {
      const email = str(body.email) || DEMO_ACCOUNT.email
      Object.assign(me, { email, name: nameOf(email) })
      return ok(tokens())
    }
    case 'POST /v1/auth/signup':
    case 'POST /v1/invites/signup':
      Object.assign(me, { email: str(body.email) || (route.includes('invites') ? 'invite.demo@example.com' : DEMO_ACCOUNT.email), name: str(body.name) || DEMO_ACCOUNT.name })
      return ok(tokens())
    case 'POST /v1/auth/refresh':
      return ok(tokens())
    case 'POST /v1/auth/logout':
    case 'POST /v1/auth/verify-email':
    case 'POST /v1/auth/forgot-password':
    case 'POST /v1/auth/reset-password':
      return ok({ ok: true })
    case 'POST /v1/auth/resend-verification':
      return ok({ ok: true, alreadyVerified: true })
    case 'GET /v1/me':
      return ok({ account: { name: me.name, email: me.email, emailVerified: true, platformAdmin: true } })
    case 'POST /v1/invites/preview':
      return ok({ teamName: DEMO_ACCOUNT.name, email: 'invite.demo@example.com', invitedBy: DEMO_ACCOUNT.name, role: 'member', hasAccount: false })
    case 'POST /v1/invites/accept':
      return ok({ team: { id: 'team_demo01', name: DEMO_ACCOUNT.name }, role: 'member' })
    default:
      return null
  }
}

function team(route: string, body: Record<string, unknown>): DemoAnswer | null {
  switch (route) {
    case 'GET /v1/team/machines':
      return ok(teamMachines())
    case 'GET /v1/team/kits':
      return ok(teamKits())
    case 'POST /v1/billing/checkout':
      return ok({ url: 'about:blank#demo_session=demo', sessionId: `cs_demo_${str((body.item as Record<string, unknown> | undefined)?.plan) || 'plan'}` })
    case 'POST /v1/billing/demo-complete':
      markPaid()
      return ok({ ok: true })
    default:
      return null
  }
}

function admin(route: string, body: Record<string, unknown>, query: URLSearchParams): DemoAnswer | null {
  switch (route) {
    case 'GET /v1/admin/overview':
      return ok(overview())
    case 'GET /v1/admin/machines':
      return ok(adminMachines())
    case 'GET /v1/admin/accounts':
      return ok(crmList(query))
    case 'GET /v1/admin/finance':
      return ok(financeDashboard(query))
    case 'POST /v1/admin/finance/settings':
      return ok(saveFinanceSettings(body))
    case 'POST /v1/admin/finance/fixed-costs':
      return ok(saveFixed(body))
    case 'GET /v1/admin/releases':
      return ok(releaseList())
    case 'GET /v1/admin/blueprints':
      return ok(blueprintState())
    case 'POST /v1/admin/blueprints': {
      const r = publishBlueprint(body)
      return r ? ok(r) : fail(400, 'invalid_blueprint', 'Blueprint illisible')
    }
    default:
      return null
  }
}

/** Routes with an id in the path. */
function withId(method: string, parts: string[], body: Record<string, unknown>): DemoAnswer {
  const [v1, area, kind, rawId, action] = parts
  const id = decodeURIComponent(rawId ?? '')
  if (v1 !== 'v1') return notFound()
  if (area === 'team' && kind === 'videos' && action === 'kit' && method === 'GET') {
    const k = teamKit(id)
    return k ? ok(k) : notFound()
  }
  if (area !== 'admin') return notFound()
  if (kind === 'accounts') {
    if (method === 'GET' && action === undefined) {
      const d = crmDetail(id)
      return d ? ok(d) : notFound()
    }
    const r = method === 'POST' && action ? crmAction(id, action, body) : null
    return r ? ok(r) : notFound()
  }
  if (kind === 'machines' && action === 'action' && method === 'POST') return machineAction(id, body.action) ? ok({ ok: true }) : fail(409, 'invalid_state', 'Action impossible dans cet état')
  if (kind === 'releases' && method === 'POST' && action) {
    const r = releaseAction(id, action)
    return r === 'ok' ? ok({ ok: true }) : r === 'missing' ? notFound() : fail(409, 'invalid_state', 'Action impossible dans cet état')
  }
  if (kind === 'finance' && rawId === 'fixed-costs' && method === 'POST') {
    const [, , , , costId, verb] = parts
    return verb === 'remove' && removeFixed(decodeURIComponent(costId ?? '')) ? ok({ ok: true }) : notFound()
  }
  return notFound()
}

/** Answers one call the way Atelier Cloud would, after a short delay so the loading states show. */
export async function demoRespond(path: string, method: 'GET' | 'POST', rawBody: unknown): Promise<DemoAnswer> {
  await new Promise((resolve) => setTimeout(resolve, 120))
  const [pathname = '/', search = ''] = path.split('?')
  const query = new URLSearchParams(search)
  const body = rawBody && typeof rawBody === 'object' ? (rawBody as Record<string, unknown>) : {}
  const route = `${method} ${pathname}`
  const answer = auth(route, body) ?? team(route, body) ?? admin(route, body, query)
  if (answer) return answer
  return withId(method, pathname.split('/').filter(Boolean), body)
}
