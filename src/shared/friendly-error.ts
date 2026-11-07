// Every error the user can meet is a calm French sentence with a next step — never a stack trace, an English message or a
// raw code (SQLITE_…, ENOSPC, ECONNREFUSED). Called at the one place errors cross to the screen (the IPC envelope, src/main/ipc.ts).
// A message already written for the user (French, plain) passes through untouched.

const RULES: readonly { test: RegExp; text: string }[] = [
  { test: /ENOSPC|SQLITE_FULL|database or disk is full|no space left/i, text: 'Le disque est plein : Atelier ne peut plus enregistrer. Libère de la place (vide la corbeille, supprime de vieux fichiers), puis réessaie.' },
  { test: /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i, text: 'Les données d’Atelier sont utilisées par autre chose pour l’instant. Patiente quelques secondes, puis réessaie. Si ça dure, ferme les autres fenêtres d’Atelier.' },
  { test: /SQLITE_CORRUPT|SQLITE_NOTADB|malformed|file is not a database/i, text: 'Le fichier de données d’Atelier est abîmé. Ferme Atelier et rouvre-le : il se remet sur la dernière sauvegarde s’il y en a une. Sinon, dis-le-moi, rien n’est perdu côté Cloud.' },
  { test: /SQLITE_READONLY|EROFS|read-only/i, text: 'Atelier ne peut pas écrire dans son dossier de données. Vérifie qu’il n’est pas en lecture seule ni dans un dossier protégé, puis réessaie.' },
  { test: /SQLITE_IOERR|SQLITE_CANTOPEN|EIO\b/i, text: 'Atelier n’arrive pas à lire ou écrire ses données (disque absent ou en panne ?). Vérifie le disque, puis relance Atelier.' },
  { test: /EACCES|EPERM|permission denied|operation not permitted/i, text: 'Atelier n’a pas le droit d’écrire à cet endroit. Choisis un autre dossier, ou ferme le programme qui utilise ce fichier, puis réessaie.' },
  { test: /ENOENT|no such file or directory/i, text: 'Un fichier est introuvable : il a peut-être été déplacé ou supprimé. Vérifie le dossier, ou refais l’étape qui l’a créé.' },
  { test: /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|network error|socket hang up|getaddrinfo|Failed to fetch|NetworkError/i, text: 'Atelier ne joint pas Internet ou le service. Vérifie ta connexion, puis réessaie : ce que tu as fait est gardé.' },
  { test: /ETIMEDOUT|timed? ?out|timeout|AbortError|aborted due to/i, text: 'Le service met trop de temps à répondre. Réessaie dans un moment : rien n’a été perdu.' },
  { test: /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid (api )?key|not signed in/i, text: 'Ta connexion n’est plus valable. Ouvre Réglages et reconnecte-toi, puis réessaie.' },
  { test: /\b429\b|rate.?limit|too many requests/i, text: 'Le service reçoit trop de demandes en ce moment. Attends une minute, puis réessaie.' },
  { test: /\b5\d\d\b|bad gateway|service unavailable|internal server error/i, text: 'Le service a un souci de son côté. Réessaie dans quelques minutes : rien n’est perdu.' },
  { test: /JSON|Unexpected token|unexpected end of|is not valid/i, text: 'Atelier a reçu une réponse qu’il ne comprend pas. Réessaie ; si ça recommence, relance Atelier.' },
  { test: /ERR_\w+|out of memory|heap|stack overflow|Maximum call stack/i, text: 'Atelier a manqué de ressources sur cet ordinateur. Ferme d’autres programmes, puis réessaie.' }
]

const ENGLISH_FALLBACK = 'Cette action n’a pas pu aboutir. Vérifie ce que tu as saisi et réessaie ; si ça recommence, relance Atelier.'
const ENGLISH_WORDS = /\b(the|is|are|not|no|cannot|can't|must|should|unknown|invalid|missing|failed|error|please|your|you|this|that|with|from|and|or|an?|at most|empty|expected|required|limit|reached|set up|yet|too|large|setting|be|changed|to|of|for|was|has|have|in|on|by|it)\b/gi

function looksEnglish(message: string): boolean {
  return (message.match(ENGLISH_WORDS)?.length ?? 0) >= 2 || /^(Unknown|Invalid|Cannot|Missing|Malformed|Write|Say|Expected)\b/.test(message)
}

const GENERIC = 'Quelque chose s’est mal passé. Réessaie ; si ça recommence, relance Atelier.'

/** A stack frame or a source location: never shown to the user. */
const STACK = /\n\s+at .*[(:]|\bat [\w$.<>]+ \(.*:\d+:\d+\)|node:internal|\.(ts|js|tsx):\d+/

const ACCENTED = /[àâäçéèêëîïôöùûüœÀÂÉÈÊÎÔÙÛÇ’«»]/
const FRENCH_WORDS = /\b(le|la|les|un|une|des|du|de|ne|pas|est|sont|Atelier|ton|ta|tes|ce|cette|pour|avec|dans|sur|ou|et|n’|d’|l’)\b/i

/** Plain French the app wrote itself (accents, or several French function words, no error code). */
function looksFrench(message: string): boolean {
  if (/\b(SQLITE|ENOSPC|ECONN|ENOENT|EACCES|ERR_)\w*/.test(message)) return false
  if (ACCENTED.test(message)) return true
  const hits = message.match(new RegExp(FRENCH_WORDS.source, 'gi'))
  return (hits?.length ?? 0) >= 3
}

/** The sentence to show for a thrown error. `code` is the error's own code when it has one. */
export function friendlyMessage(message: string, code?: string): string {
  const raw = (message ?? '').trim()
  const haystack = `${code ?? ''} ${raw}`
  for (const r of RULES) if (r.test.test(haystack) && !(looksFrench(raw) && !STACK.test(raw))) return r.text
  if (raw === '' || STACK.test(raw)) return GENERIC
  // A sentence a developer wrote in English (« Unknown agent: x »): the user cannot act on it.
  if (!looksFrench(raw) && looksEnglish(raw)) return ENGLISH_FALLBACK
  // The app's own wording (French): kept, so the screen can say what is wrong.
  return raw.length > 400 ? `${raw.slice(0, 397)}…` : raw
}

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/\b(authorization|proxy-authorization)\s*[:=]\s*(bearer|basic)?\s*[^\s,;"']+/gi, '$1: [masqué]'],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [masqué]'],
  [/\b(sk|pk|rk|xox[a-z]?|ghp|gho|ghs|AIza)[-_][A-Za-z0-9_-]{16,}/g, '[masqué]'],
  [/\b(token|secret|password|passwd|api[_-]?key|key|code|cookie)(["']?\s*[:=]\s*)["']?[^\s,;"'&]{4,}["']?/gi, '$1$2[masqué]'],
  [/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '[masqué]']
]

/**
 * The precise technical reason of an error, for the callers that are not a person reading the screen (the team computer's
 * brain, brain-run, agents): same text as thrown, without stack frames, secrets or tokens, capped. Never shown to the user.
 */
export function technicalDetail(message: string): string {
  let out = (message ?? '').split('\n').filter((l) => !/^\s+at .*[(:]/.test(l)).join(' ').trim()
  for (const [re, to] of SECRET_PATTERNS) out = out.replace(re, to)
  return out.length > 600 ? `${out.slice(0, 597)}…` : out
}
