// The e-mails, in French and English: our own wording, a plain-text part and a simple HTML part (no images, no tracking
// pixel, no tracked links). Every piece of data is escaped in the HTML and stripped of control characters in the text.
export type MailLang = 'fr' | 'en'
export const MAIL_LANGS: readonly MailLang[] = ['fr', 'en']

export type Template =
  | { kind: 'verify'; name: string; link: string }
  | { kind: 'reset'; name: string; link: string }
  | { kind: 'receipt'; name: string; item: 'plan' | 'renewal' | 'pack' | 'topup'; plan?: string; period?: 'month' | 'year'; credits: number; cents: number }
  | { kind: 'payment_failed'; name: string; plan: string; link: string }
  | { kind: 'topup_failed'; name: string; credits: number; cents: number; link: string }
  | { kind: 'plan_canceled'; name: string; plan: string; link: string }
  | { kind: 'machine_ready'; name: string; plan: string; count: number; link: string }
  | { kind: 'spend_unusual'; name: string; credits: number; usual: number; link: string }
  | { kind: 'invite'; name: string; inviter: string; team: string; role: 'admin' | 'member'; link: string }

export type TemplateKind = Template['kind']

export interface Rendered {
  subject: string
  text: string
  html: string
}

/** What every message is made of: a subject, a greeting, paragraphs, optional detail lines, an optional button, a footer. */
interface Doc {
  subject: string
  greeting: string
  paragraphs: string[]
  details?: [label: string, value: string][]
  action?: { label: string; url: string }
  footer: string
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** A person's name or a plan name as one safe line of text (no control character, no line break). */
export const oneLine = (s: string): string => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

const safeUrl = (u: string): string => (/^https?:\/\/[^\s"'<>]+$/.test(u) ? u : '#')

function money(cents: number, lang: MailLang): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}
const num = (n: number, lang: MailLang): string => new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB').format(n)

function fr(t: Template): Doc {
  const name = oneLine(t.name)
  const hello = name ? `Bonjour ${name},` : 'Bonjour,'
  switch (t.kind) {
    case 'verify':
      return {
        subject: 'Confirme ton adresse e-mail',
        greeting: hello,
        paragraphs: [
          'Pour finir ton inscription à Atelier, confirme ton adresse e-mail. Tant qu’elle n’est pas confirmée, tu peux parcourir ton espace, mais pas payer ni lancer de travail payant.',
          'Ce lien est valable 24 heures et ne sert qu’une fois.'
        ],
        action: { label: 'Confirmer mon adresse', url: t.link },
        footer: 'Tu n’as pas créé de compte Atelier ? Ignore ce message : rien ne sera fait.'
      }
    case 'reset':
      return {
        subject: 'Réinitialise ton mot de passe Atelier',
        greeting: hello,
        paragraphs: [
          'Tu as demandé à changer ton mot de passe. Ce lien est valable 1 heure et ne sert qu’une fois.',
          'Quand tu l’utilises, tous les appareils connectés à ton compte sont déconnectés.'
        ],
        action: { label: 'Choisir un nouveau mot de passe', url: t.link },
        footer: 'Tu n’as rien demandé ? Ignore ce message : ton mot de passe reste le même.'
      }
    case 'receipt': {
      const every = t.period === 'year' ? 'annuel' : 'mensuel'
      const what =
        t.item === 'plan'
          ? `Plan ${oneLine(t.plan ?? '')} (${every})`
          : t.item === 'renewal'
            ? `Renouvellement du plan ${oneLine(t.plan ?? '')} (${every})`
            : t.item === 'pack'
              ? `Pack de ${num(t.credits, 'fr')} crédits`
              : `Recharge automatique de ${num(t.credits, 'fr')} crédits`
      return {
        subject: `Reçu : ${what}`,
        greeting: hello,
        paragraphs: ['Merci, ton paiement est bien reçu et tes crédits sont déjà disponibles.'],
        details: [
          ['Achat', what],
          ['Montant', `${money(t.cents, 'fr')} HT`],
          ['Crédits ajoutés', num(t.credits, 'fr')]
        ],
        footer: 'Une question sur un paiement ? Réponds simplement à ce message.'
      }
    }
    case 'payment_failed':
      return {
        subject: `Le paiement de ton plan ${oneLine(t.plan)} a échoué`,
        greeting: hello,
        paragraphs: [
          `Ton moyen de paiement a été refusé pour le plan ${oneLine(t.plan)}. Le plan est en attente : mets ta carte à jour pour continuer à utiliser Atelier sans interruption.`
        ],
        action: { label: 'Ouvrir mon espace', url: t.link },
        footer: 'Si tu viens déjà de régler le problème, tu peux ignorer ce message.'
      }
    case 'topup_failed':
      return {
        subject: 'La recharge automatique a échoué',
        greeting: hello,
        paragraphs: [
          `Ta carte a été refusée pour la recharge automatique de ${num(t.credits, 'fr')} crédits (${money(t.cents, 'fr')} HT). Aucun crédit n’a été ajouté.`,
          'Les travaux payants s’arrêtent quand le solde est vide : mets ta carte à jour ou achète un pack.'
        ],
        action: { label: 'Ouvrir mon espace', url: t.link },
        footer: 'Nous ne réessayons pas tout de suite : la recharge repart au prochain passage sous ton seuil.'
      }
    case 'plan_canceled':
      return {
        subject: `Ton plan ${oneLine(t.plan)} est résilié`,
        greeting: hello,
        paragraphs: [
          `Ton abonnement au plan ${oneLine(t.plan)} est terminé. Tes ordinateurs d’équipe sont mis en veille et tes fichiers sont conservés.`,
          'Tu peux reprendre un plan quand tu veux.'
        ],
        action: { label: 'Voir les plans', url: t.link },
        footer: 'Tu n’as pas demandé cette résiliation ? Réponds à ce message.'
      }
    case 'machine_ready':
      return {
        subject: t.count > 1 ? 'Tes ordinateurs d’équipe sont prêts' : 'Ton ordinateur d’équipe est prêt',
        greeting: hello,
        paragraphs: [
          t.count > 1
            ? `Ton plan ${oneLine(t.plan)} est actif et ${t.count} ordinateurs d’équipe tournent. Tu peux ouvrir Atelier et leur donner du travail.`
            : `Ton plan ${oneLine(t.plan)} est actif et ton ordinateur d’équipe tourne. Tu peux ouvrir Atelier et lui donner du travail.`
        ],
        action: { label: 'Ouvrir Atelier', url: t.link },
        footer: 'Bonne production.'
      }
    case 'spend_unusual':
      return {
        subject: 'Dépense inhabituelle sur ton équipe',
        greeting: hello,
        paragraphs: [
          `Ton équipe a dépensé ${num(t.credits, 'fr')} crédits en 24 heures, alors qu’elle en dépense d’habitude environ ${num(t.usual, 'fr')} par jour.`,
          'Rien n’est bloqué : tu peux dépenser tes crédits comme tu veux. Si ce n’est pas toi ou ton équipe, contacte le support tout de suite en répondant à ce message.'
        ],
        action: { label: 'Voir mes dépenses', url: t.link },
        footer: 'Ce message part au plus une fois par jour.'
      }
    case 'invite':
      return {
        subject: `${oneLine(t.inviter)} t’invite dans l’équipe ${oneLine(t.team)} sur Atelier`,
        greeting: 'Bonjour,',
        paragraphs: [
          `${oneLine(t.inviter)} t’invite à rejoindre l’équipe ${oneLine(t.team)} sur Atelier, ${t.role === 'admin' ? 'comme administrateur' : 'comme membre'}.`,
          'Ouvre le lien pour créer ton compte ou te connecter, puis rejoindre l’équipe. Il est valable 7 jours et ne sert qu’une fois.'
        ],
        action: { label: 'Rejoindre l’équipe', url: t.link },
        footer: 'Tu ne connais pas cette équipe ? Ignore ce message : rien ne sera fait.'
      }
  }
}

function en(t: Template): Doc {
  const name = oneLine(t.name)
  const hello = name ? `Hello ${name},` : 'Hello,'
  switch (t.kind) {
    case 'verify':
      return {
        subject: 'Confirm your e-mail address',
        greeting: hello,
        paragraphs: [
          'To finish signing up to Atelier, confirm your e-mail address. Until it is confirmed you can browse your space, but you cannot pay or start paid work.',
          'This link is valid for 24 hours and works once.'
        ],
        action: { label: 'Confirm my address', url: t.link },
        footer: 'You did not create an Atelier account? Ignore this message: nothing will be done.'
      }
    case 'reset':
      return {
        subject: 'Reset your Atelier password',
        greeting: hello,
        paragraphs: [
          'You asked to change your password. This link is valid for 1 hour and works once.',
          'When you use it, every device signed in to your account is signed out.'
        ],
        action: { label: 'Choose a new password', url: t.link },
        footer: 'You did not ask for this? Ignore this message: your password stays the same.'
      }
    case 'receipt': {
      const every = t.period === 'year' ? 'yearly' : 'monthly'
      const what =
        t.item === 'plan'
          ? `${oneLine(t.plan ?? '')} plan (${every})`
          : t.item === 'renewal'
            ? `Renewal of the ${oneLine(t.plan ?? '')} plan (${every})`
            : t.item === 'pack'
              ? `Pack of ${num(t.credits, 'en')} credits`
              : `Automatic top-up of ${num(t.credits, 'en')} credits`
      return {
        subject: `Receipt: ${what}`,
        greeting: hello,
        paragraphs: ['Thank you, your payment has been received and your credits are already available.'],
        details: [
          ['Purchase', what],
          ['Amount', `${money(t.cents, 'en')} excl. VAT`],
          ['Credits added', num(t.credits, 'en')]
        ],
        footer: 'A question about a payment? Just reply to this message.'
      }
    }
    case 'payment_failed':
      return {
        subject: `Payment for your ${oneLine(t.plan)} plan failed`,
        greeting: hello,
        paragraphs: [
          `Your payment method was declined for the ${oneLine(t.plan)} plan. The plan is on hold: update your card to keep using Atelier without interruption.`
        ],
        action: { label: 'Open my space', url: t.link },
        footer: 'If you have already fixed this, you can ignore this message.'
      }
    case 'topup_failed':
      return {
        subject: 'Automatic top-up failed',
        greeting: hello,
        paragraphs: [
          `Your card was declined for the automatic top-up of ${num(t.credits, 'en')} credits (${money(t.cents, 'en')} excl. VAT). No credits were added.`,
          'Paid work stops when the balance runs out: update your card or buy a pack.'
        ],
        action: { label: 'Open my space', url: t.link },
        footer: 'We do not retry right away: the top-up runs again the next time you fall under your threshold.'
      }
    case 'plan_canceled':
      return {
        subject: `Your ${oneLine(t.plan)} plan has ended`,
        greeting: hello,
        paragraphs: [
          `Your ${oneLine(t.plan)} subscription has ended. Your team computers are put to sleep and your files are kept.`,
          'You can pick a plan again whenever you like.'
        ],
        action: { label: 'See the plans', url: t.link },
        footer: 'You did not ask for this cancellation? Reply to this message.'
      }
    case 'machine_ready':
      return {
        subject: t.count > 1 ? 'Your team computers are ready' : 'Your team computer is ready',
        greeting: hello,
        paragraphs: [
          t.count > 1
            ? `Your ${oneLine(t.plan)} plan is active and ${t.count} team computers are running. Open Atelier and give them work.`
            : `Your ${oneLine(t.plan)} plan is active and your team computer is running. Open Atelier and give it work.`
        ],
        action: { label: 'Open Atelier', url: t.link },
        footer: 'Happy producing.'
      }
    case 'spend_unusual':
      return {
        subject: 'Unusual spending on your team',
        greeting: hello,
        paragraphs: [
          `Your team spent ${num(t.credits, 'en')} credits in 24 hours, while it usually spends about ${num(t.usual, 'en')} a day.`,
          'Nothing is blocked: your credits are yours to spend. If this was not you or your team, contact support right away by replying to this message.'
        ],
        action: { label: 'See my spending', url: t.link },
        footer: 'This message is sent at most once a day.'
      }
    case 'invite':
      return {
        subject: `${oneLine(t.inviter)} invites you to the ${oneLine(t.team)} team on Atelier`,
        greeting: 'Hello,',
        paragraphs: [
          `${oneLine(t.inviter)} invites you to join the ${oneLine(t.team)} team on Atelier, ${t.role === 'admin' ? 'as an administrator' : 'as a member'}.`,
          'Open the link to create your account or sign in, then join the team. It is valid for 7 days and works once.'
        ],
        action: { label: 'Join the team', url: t.link },
        footer: 'You do not know this team? Ignore this message: nothing will be done.'
      }
  }
}

export function render(t: Template, lang: MailLang): Rendered {
  const d = lang === 'en' ? en(t) : fr(t)
  const colon = lang === 'en' ? ':' : ' :'
  const textParts = [d.greeting, ...d.paragraphs]
  if (d.details) textParts.push(d.details.map(([k, v]) => `${k}${colon} ${v}`).join('\n'))
  if (d.action) textParts.push(`${d.action.label}${colon}\n${d.action.url}`)
  textParts.push(d.footer, '— Atelier')
  const e = escapeHtml
  const link = e(safeUrl(d.action?.url ?? ''))
  const html = [
    '<!doctype html>',
    `<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(d.subject)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6">',
    '<div style="max-width:520px;margin:0 auto">',
    `<p style="margin:0 0 16px">${e(d.greeting)}</p>`,
    ...d.paragraphs.map((p) => `<p style="margin:0 0 16px">${e(p)}</p>`),
    ...(d.details
      ? [
          `<table role="presentation" style="margin:0 0 16px;border-collapse:collapse">${d.details
            .map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#666666">${e(k)}</td><td style="padding:2px 0"><strong>${e(v)}</strong></td></tr>`)
            .join('')}</table>`
        ]
      : []),
    ...(d.action
      ? [
          `<p style="margin:24px 0"><a href="${link}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:10px">${e(d.action.label)}</a></p>`,
          `<p style="margin:0 0 16px;font-size:13px;color:#666666">${e(lang === 'en' ? 'If the button does not work, copy this address into your browser:' : 'Si le bouton ne marche pas, copie cette adresse dans ton navigateur :')}<br><a href="${link}" style="color:#666666;word-break:break-all">${e(d.action.url)}</a></p>`
        ]
      : []),
    `<p style="margin:24px 0 0;font-size:13px;color:#666666">${e(d.footer)}</p>`,
    '<p style="margin:8px 0 0;font-size:13px;color:#666666">Atelier</p>',
    '</div></body></html>'
  ].join('\n')
  return { subject: oneLine(d.subject), text: textParts.join('\n\n') + '\n', html }
}
