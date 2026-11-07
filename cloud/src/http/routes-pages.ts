// The two routes outside /v1: the browser page that approves a device login (French UI, no script, strict CSP),
// and the signed download link (the signature is the credential).
import type { FastifyInstance, FastifyReply } from 'fastify'
import { DEVICE_VERIFY_PATH, SIGNED_FILE_PATH } from '../../../src/shared/cloud-api.ts'
import type { Cloud } from '../cloud.ts'
import { CloudError } from '../errors.ts'
import { MIN_PASSWORD } from '../accounts.ts'
import { DIRECT_LINK_TTL_S } from '../storage.ts'
import { baseUrlOf } from './routes-user.ts'
import type { RateLimiter } from './route.ts'

const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

function page(reply: FastifyReply, status: number, title: string, body: string): FastifyReply {
  return reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', PAGE_CSP)
    .header('x-frame-options', 'DENY')
    // same-origin, not no-referrer: with no-referrer browsers send `Origin: null` on the form's POST, which the
    // cross-origin check refuses; other sites still never see the address (and its code)
    .header('referrer-policy', 'same-origin')
    .header('cache-control', 'no-store')
    .send(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
        `<style>body{font-family:system-ui,sans-serif;max-width:26rem;margin:4rem auto;padding:0 1rem;color:#222}` +
        `label{display:block;margin:.8rem 0 .2rem}input{width:100%;padding:.5rem;font-size:1rem;box-sizing:border-box}` +
        `button{margin-top:1.2rem;padding:.6rem 1rem;font-size:1rem}.err{color:#a40000}</style></head>` +
        `<body><h1>${escapeHtml(title)}</h1>${body}</body></html>`
    )
}

function form(code: string, error: string | null, pending: { deviceName: string; createdAt: string } | null): string {
  // The device and the time are shown so a person can tell a login they did not start (a phishing link) from theirs.
  const who = pending
    ? `<p>Appareil : <strong>${escapeHtml(pending.deviceName)}</strong>, demandé le ${escapeHtml(pending.createdAt.slice(0, 16).replace('T', ' à '))} (UTC).</p>`
    : ''
  return (
    (error ? `<p class="err">${escapeHtml(error)}</p>` : '') +
    who +
    `<p>Vérifie que ce code et cet appareil sont bien ceux qu’Atelier affiche à l’instant sur ton ordinateur. Sinon, ferme cette page.</p>` +
    `<form method="post" action="${DEVICE_VERIFY_PATH}">` +
    `<label for="code">Code</label><input id="code" name="code" value="${escapeHtml(code)}" autocomplete="off" required>` +
    `<label for="email">Adresse e-mail</label><input id="email" name="email" type="email" autocomplete="username" required>` +
    `<label for="password">Mot de passe</label><input id="password" name="password" type="password" autocomplete="current-password" required>` +
    `<button type="submit">Autoriser cet appareil</button></form>` +
    `<p><a href="${DEVICE_VERIFY_PATH}?${new URLSearchParams({ code, new: '1' }).toString()}">Pas encore de compte ? Créer un compte</a></p>`
  )
}

/** « Créer un compte »: a new account (its own team, address to confirm by e-mail) that approves the device at once. */
function signupForm(code: string, error: string | null, pending: { deviceName: string; createdAt: string } | null, values: { name: string; email: string }): string {
  const who = pending ? `<p>Appareil : <strong>${escapeHtml(pending.deviceName)}</strong>.</p>` : ''
  return (
    (error ? `<p class="err">${escapeHtml(error)}</p>` : '') +
    who +
    `<p>Crée ton compte Atelier : cet appareil sera autorisé dans la foulée. Un e-mail te demandera de confirmer ton adresse avant de payer ou de lancer un travail payant.</p>` +
    `<form method="post" action="${DEVICE_VERIFY_PATH}">` +
    `<label for="code">Code</label><input id="code" name="code" value="${escapeHtml(code)}" autocomplete="off" required>` +
    `<label for="name">Ton nom</label><input id="name" name="name" value="${escapeHtml(values.name)}" autocomplete="name" maxlength="100" required>` +
    `<label for="email">Adresse e-mail</label><input id="email" name="email" type="email" value="${escapeHtml(values.email)}" autocomplete="email" required>` +
    `<label for="password">Mot de passe (${MIN_PASSWORD} caractères au moins)</label><input id="password" name="password" type="password" minlength="${MIN_PASSWORD}" autocomplete="new-password" required>` +
    `<button type="submit">Créer mon compte et autoriser cet appareil</button></form>` +
    `<p><a href="${DEVICE_VERIFY_PATH}?${new URLSearchParams({ code }).toString()}">J’ai déjà un compte : me connecter</a></p>`
  )
}

const FR_ERRORS: Partial<Record<string, string>> = {
  gone: 'Ce code est inconnu ou a expiré. Relance la connexion depuis Atelier.',
  conflict: 'Ce code a déjà été autorisé.',
  unauthorized: 'Adresse e-mail ou mot de passe incorrect.',
  forbidden: "Ce compte n'appartient à aucune équipe.",
  rate_limited: 'Trop de mots de passe erronés. Réessaie dans 15 minutes.'
}

const SIGNUP_ERRORS: Partial<Record<string, string>> = {
  gone: 'Ce code est inconnu ou a expiré. Relance la connexion depuis Atelier.',
  conflict: 'Un compte utilise déjà cette adresse : connecte-toi plutôt.',
  bad_request: `Vérifie ton nom, ton adresse e-mail et ton mot de passe (${MIN_PASSWORD} caractères au moins).`,
  rate_limited: 'Trop de demandes. Réessaie dans quelques minutes.'
}

export function registerPageRoutes(app: FastifyInstance, cloud: Cloud, limiter: RateLimiter): void {
  app.get(DEVICE_VERIFY_PATH, async (req, reply) => {
    limiter.hit(`ip:${req.ip}`)
    const q = req.query as { code?: unknown; new?: unknown }
    const code = String(q.code ?? '').slice(0, 20)
    const pending = code ? cloud.auth.pendingLogin(code) : null
    if (q.new === '1') return page(reply, 200, 'Créer un compte Atelier', signupForm(code, null, pending, { name: '', email: '' }))
    return page(reply, 200, 'Connecter Atelier', form(code, null, pending))
  })

  app.post(DEVICE_VERIFY_PATH, async (req, reply) => {
    limiter.hit(`ip:${req.ip}`)
    const origin = req.headers.origin
    if (origin !== undefined && origin !== baseUrlOf(req)) throw new CloudError('forbidden', 'cross-origin form')
    const b = (req.body ?? {}) as Record<string, unknown>
    const code = String(b.code ?? '').slice(0, 20)
    if (typeof b.name === 'string') return signupAndApprove(reply, cloud, code, b)
    try {
      await cloud.auth.approve({ userCode: code, email: String(b.email ?? ''), password: String(b.password ?? '') })
    } catch (err) {
      if (!(err instanceof CloudError)) throw err
      const status = err.code === 'unauthorized' ? 401 : err.code === 'rate_limited' ? 429 : 400
      return page(reply, status, 'Connecter Atelier', form(code, FR_ERRORS[err.code] ?? 'Impossible de valider ce code.', cloud.auth.pendingLogin(code)))
    }
    return page(reply, 200, 'Appareil autorisé', '<p>C’est fait. Tu peux revenir dans Atelier : la connexion se termine toute seule.</p>')
  })

  app.get(SIGNED_FILE_PATH, async (req, reply) => {
    limiter.hit(`ip:${req.ip}`)
    const { id } = req.params as { id: string }
    const q = req.query as { exp?: string; sig?: string }
    const a = cloud.storage.verify(id, q.exp, q.sig)
    // In an object store the bytes come from there: a short-lived redirect (the signed Cloud link is the credential).
    const direct = cloud.storage.presign(a, DIRECT_LINK_TTL_S)
    if (direct) return reply.header('cache-control', 'private, no-store').redirect(direct, 302)
    const safeName = a.name.replace(/[^A-Za-z0-9._-]/g, '_')
    return reply
      .header('content-type', a.mime)
      .header('content-length', a.size)
      .header('content-disposition', `attachment; filename="${safeName}"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store')
      .send(await cloud.storage.read(a))
  })
}

/** The sign-up mode of the device page: the code must still be waiting, then the account is made and the device approved. */
async function signupAndApprove(reply: FastifyReply, cloud: Cloud, code: string, b: Record<string, unknown>): Promise<FastifyReply> {
  const name = String(b.name ?? '').slice(0, 100)
  const email = String(b.email ?? '').trim().slice(0, 200)
  const password = String(b.password ?? '').slice(0, 200)
  const again = (status: number, codeOf: string): FastifyReply =>
    page(reply, status, 'Créer un compte Atelier', signupForm(code, SIGNUP_ERRORS[codeOf] ?? 'Impossible de créer ce compte.', cloud.auth.pendingLogin(code), { name, email }))
  // a code that is not waiting any more creates no account
  if (!cloud.auth.pendingLogin(code)) return again(400, 'gone')
  if (!name.trim() || password.length < MIN_PASSWORD) return again(400, 'bad_request')
  try {
    if (cloud.accounts.accountByEmail(email)) throw new CloudError('conflict', 'an account already uses this e-mail address')
    const { account } = cloud.accounts.createAccount({ email, name, password, verified: false, actor: 'signup' })
    cloud.emailFlows.sendVerification(account.id)
    await cloud.auth.approve({ userCode: code, email, password })
  } catch (err) {
    if (!(err instanceof CloudError)) throw err
    return again(err.code === 'rate_limited' ? 429 : 400, err.code)
  }
  return page(reply, 200, 'Appareil autorisé', '<p>Ton compte est créé et cet appareil est autorisé. Tu peux revenir dans Atelier : la connexion se termine toute seule. Pense à confirmer ton adresse avec le lien reçu par e-mail.</p>')
}
