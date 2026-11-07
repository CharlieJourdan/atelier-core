// The demo script of `script.write` (docs/ENGINE-SPEC.md §17 Fake): a deterministic narration of EXACTLY W words in
// French or English that reads like a calm documentary, with a hook-shaped first paragraph, a body made of generic
// sentences of 8 to 16 words, a few figures, and a closing paragraph that pays off the opening question. The same seed
// always gives the same text; another seed changes the year, the figure and the choice of sentences. No invented quotes
// and no real facts: the sentences are deliberately generic.
// moteur-pov-2: given the things the reference handles in the viewer's hands (`objects`, measured), the demo follows that pattern:
// a second-person opening built on those things (a ticket's numbers, the results on the phone…) at the measured rate over the
// opening, then at the body's rate, so the free demo can show what the reference shows. Our own sentences, never the reference's.
import { seededRandom } from '../errors'
import { countWords } from '../text/script'

export type DemoHold = 'ticket' | 'phone' | 'card' | 'paper' | 'note' | 'bill'
export type DemoDetail = 'numbers' | 'results' | 'call' | 'message' | 'price' | 'plain'
export interface DemoObjects {
  /** The things, most frequent first, with what is on them and their share of the first-person time. */
  objects: readonly { hold: DemoHold; detail: DemoDetail; share: number }[]
  /** Share of the opening's sentences that handle one (the measured first-person share over the opening). */
  openingShare: number
  /** How many words the opening lasts (its seconds at the script's pace). */
  openingWords: number
  /** The share after the opening. */
  bodyShare: number
}

/** Our own object sentences (second person, the channel's « tu »), by thing and by what is on it. */
const OBJECT_LINES: Record<'fr' | 'en', Record<DemoHold, Partial<Record<DemoDetail, string[]>> & { plain: string[] }>> = {
  fr: {
    ticket: {
      numbers: ['Tu sors ton ticket et tu relis chaque numéro de ta grille.', 'Tu poses le ticket sur la table, les numéros bien en vue.', 'Tu tiens ton ticket entre deux doigts sans oser le lâcher.', 'Tu retournes ton ticket pour vérifier la date du tirage.'],
      plain: ['Tu glisses le ticket dans ta poche sans y penser.', 'Tu retrouves le ticket au fond de ta veste.']
    },
    phone: {
      results: ['Tu prends ton téléphone et tu ouvres la page des résultats.', 'Sur ton téléphone, les numéros du tirage s’affichent un par un.', 'Tu compares les résultats sur ton téléphone avec ta grille.'],
      call: ['Ton téléphone sonne, un appel que tu n’attendais pas.', 'Tu prends ton téléphone pour appeler quelqu’un, puis tu le reposes.'],
      message: ['Ton téléphone vibre, une notification vient d’arriver.', 'Un nouveau message s’affiche sur ton téléphone.'],
      plain: ['Tu attrapes ton téléphone et tu fais défiler l’écran.']
    },
    card: { price: ['Tu sors ta carte bancaire et tu regardes le solde affiché.'], plain: ['Tu poses ta carte bancaire sur le comptoir.'] },
    bill: { price: ['Tu tiens la facture entre tes mains et tu relis le montant.'], plain: ['Tu poses la facture sur la table.'] },
    paper: { plain: ['Tu déplies la lettre et tu la relis lentement.', 'Tu signes le document sans vraiment le lire.'] },
    note: { plain: ['Tu colles un post-it sur le frigo pour ne pas oublier.'] }
  },
  en: {
    ticket: {
      numbers: ['You take out your ticket and read every number on it again.', 'You lay the ticket on the table with its numbers in plain view.', 'You hold your ticket between two fingers and dare not let go.', 'You turn your ticket over to check the date of the draw.'],
      plain: ['You slip the ticket into your pocket without a thought.', 'You find the ticket at the bottom of your jacket.']
    },
    phone: {
      results: ['You pick up your phone and open the results page.', 'On your phone, the numbers of the draw appear one by one.', 'You compare the results on your phone with your ticket.'],
      call: ['Your phone rings, a call you did not expect.', 'You pick up your phone to call someone, then put it down.'],
      message: ['Your phone buzzes, a notification has just arrived.', 'A new message lights up your phone.'],
      plain: ['You grab your phone and scroll through the screen.']
    },
    card: { price: ['You take out your bank card and look at the balance.'], plain: ['You put your bank card on the counter.'] },
    bill: { price: ['You hold the bill in your hands and read the amount again.'], plain: ['You put the bill on the table.'] },
    paper: { plain: ['You unfold the letter and read it again slowly.', 'You sign the document without really reading it.'] },
    note: { plain: ['You stick a note on the fridge so you will not forget.'] }
  }
}

/** A second-person story's own sentences (moteur-pov-2): places lived, reactions, amounts — never a lecture about dates. */
const STORY: Record<'fr' | 'en', { scenes: string[]; reactions: string[]; amounts: string[]; jumps: string[]; questions: string[] }> = {
  fr: {
    scenes: [
      'Tu marches dans la rue, les mains dans les poches.',
      'Tu rentres chez toi et tu poses tes clés sur la table.',
      'Tu t’assois sur le bord de ton lit sans rien dire.',
      'Au bureau, personne ne remarque que quelque chose a changé.',
      'Tu passes devant la banque sans oser entrer.',
      'Dehors, les voisins continuent leur journée comme si de rien n’était.',
      'Tu regardes la ville depuis ta fenêtre pendant un long moment.',
      'Dans la cuisine, tu te prépares un café pour te calmer.',
      'Tu traverses le hall d’entrée sans croiser personne.'
    ],
    reactions: ['Ton cœur s’accélère d’un coup.', 'Tu n’arrives pas à y croire.', 'Un sourire te monte aux lèvres malgré toi.', 'Une petite inquiétude s’installe dans ta tête.', 'Tu restes figé une seconde.'],
    jumps: ['Quatre jours plus tard, tu y penses encore sans arrêt.', 'Le lendemain matin, rien ne semble avoir changé autour de toi.', 'Une semaine plus tard, tu n’en as parlé à personne.'],
    questions: ['Mais est-ce que quelqu’un pourrait le découvrir ?', 'Et si tout pouvait encore s’arrêter ?', 'Le ticket peut-il vraiment expirer ?'],
    amounts: ['Sur ton compte, il y a maintenant {n} millions d’euros.', 'Il te faudrait {n} ans de salaire pour gagner autant.', 'Chaque semaine, {n} millions de personnes tentent leur chance.']
  },
  en: {
    scenes: [
      'You walk down the street with your hands in your pockets.',
      'You come home and drop your keys on the table.',
      'You sit on the edge of your bed without a word.',
      'At the office, nobody notices that something has changed.',
      'You walk past the bank without daring to go in.',
      'Outside, the neighbours go on with their day as if nothing happened.',
      'You look at the city from your window for a long moment.',
      'In the kitchen, you make yourself a coffee to calm down.',
      'You cross the lobby without meeting anyone.'
    ],
    reactions: ['Your heart starts racing.', 'You cannot believe it.', 'A smile comes to your lips despite yourself.', 'A small worry settles in your mind.', 'You freeze for a second.'],
    jumps: ['Four days later, you still think about it all the time.', 'The next morning, nothing around you seems to have changed.', 'A week later, you have told nobody.'],
    questions: ['But could someone find out?', 'What if it could still all stop?', 'Can the ticket really expire?'],
    amounts: ['There are now {n} million euros in your account.', 'You would need {n} years of salary to earn that much.', 'Every week, {n} million people try their luck.']
  }
}

/** One sentence handling a thing (seeded): its detail's lines, else its plain ones. */
export function objectSentence(lang: string, o: { hold: DemoHold; detail: DemoDetail }, r: () => number): string {
  const bank = OBJECT_LINES[lang === 'fr' ? 'fr' : 'en'][o.hold]
  const list = bank[o.detail] ?? bank.plain
  return list[Math.floor(r() * list.length) % list.length] as string
}

type Rnd = () => number

const pick = <T>(r: Rnd, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length] as T

interface Bank {
  subjects: string[]
  verbs: string[]
  tails: string[]
  /** Sentences with a figure; `{y}` is a year and `{n}` a number. */
  figures: string[]
  /** Short sentences used to land on the exact word count (any length 1..16 is built from these). */
  closers: string[]
  hook: (topic: string, y: number, n: number, r: Rnd) => string[]
  payoff: string
}

const FR: Bank = {
  subjects: ['Ce détail', 'Cette période', 'Le contexte', 'Chaque étape', 'Le point de départ', 'Ce moment précis', 'Cet épisode', 'Le fil du récit'],
  verbs: [
    'éclaire la suite des événements',
    'change la manière de lire les faits',
    'explique bien des choses que l’on ignorait',
    'pèse plus lourd qu’on ne le pense',
    'révèle un mécanisme simple mais discret',
    'reste souvent oublié des récits trop rapides',
    'prépare tout ce qui va suivre'
  ],
  tails: [
    'dès les premières pages du dossier',
    'à y regarder de près',
    'sans que personne le remarque',
    'année après année',
    'dans les sources disponibles',
    'et cela se voit ensuite'
  ],
  figures: [
    'En {y}, un changement net apparaît dans les sources disponibles.',
    'Autour de {y}, le rythme des événements s’accélère de façon visible.',
    'Un repère revient souvent dans les récits, le chiffre {n}.',
    'Le nombre {n} sert ici de repère pour mesurer l’ampleur du phénomène.'
  ],
  closers: [
    'Voilà.',
    'C’est tout.',
    'Le reste suit.',
    'Tout se tient ici.',
    'Les faits parlent d’eux-mêmes ici.',
    'Il reste pourtant beaucoup à comprendre.',
    'La question mérite d’être posée avec calme.',
    'Chaque réponse ouvre aussi une nouvelle question simple.',
    'Le récit, pris dans l’ordre, devient enfin assez lisible.',
    'Rien ne remplace un regard patient posé sur les faits.',
    'On comprend mieux ce dossier quand on le relit sans hâte.',
    'On comprend mieux ce dossier quand on le relit sans se presser.',
    'Les détails les plus modestes expliquent souvent les plus grands changements.',
    'Il suffit parfois d’un seul détail pour que tout le reste prenne enfin sa place.',
    'Ce qui paraissait confus au départ devient clair dès que les faits retrouvent leur ordre.',
    'Une fois l’essentiel posé, le reste de l’histoire se raconte presque de lui-même sans effort.'
  ],
  hook: (topic, y, n, r) => [
    `Que sait-on vraiment de ce sujet, ${topic}?`,
    pick(r, [`Une date revient sans cesse dans ce dossier, ${y}.`, `Tout semble reposer sur une seule date, ${y}.`]),
    `Un seul chiffre, ${n}, rend la réponse bien moins évidente qu’elle n’en a l’air.`,
    'Que s’est-il vraiment passé?'
  ],
  payoff: 'Voilà donc la réponse à la question du début, les faits remis dans l’ordre racontent déjà l’essentiel.'
}

const EN: Bank = {
  subjects: ['This detail', 'That period', 'The context', 'Each step', 'The starting point', 'This precise moment', 'This episode', 'The thread of the story'],
  verbs: [
    'sheds light on what happened next',
    'changes how the facts are read',
    'explains more than people expected',
    'weighs more than it first appears',
    'reveals a simple but quiet mechanism',
    'is often forgotten in quick retellings',
    'prepares everything that follows'
  ],
  tails: [
    'from the first pages of the record',
    'when you look closely',
    'without anyone noticing',
    'year after year',
    'in the sources we have',
    'and it shows later on'
  ],
  figures: [
    'In {y}, a clear change appears in the sources we have.',
    'Around {y}, the pace of events picks up in a visible way.',
    'One landmark keeps coming back in the accounts, the number {n}.',
    'The number {n} serves here as a yardstick for the scale of the phenomenon.'
  ],
  closers: [
    'Exactly.',
    'That is all.',
    'The rest follows.',
    'Everything fits together here.',
    'The facts speak for themselves here.',
    'Still, a great deal remains to be understood.',
    'The question deserves to be asked calmly.',
    'Every answer also opens a new and simple question.',
    'Taken in order, the story finally becomes quite readable.',
    'Nothing replaces a patient look at the facts.',
    'This story is easier to follow when you reread it without hurry.',
    'The smallest details often explain the biggest changes of all.',
    'Sometimes a single detail is enough for everything else to fall into place.',
    'What looked confusing at first becomes clear as soon as the facts return to their order.',
    'Once the essentials are laid down, the rest of the story almost tells itself without effort.'
  ],
  hook: (topic, y, n, r) => [
    `What do we really know about this subject, ${topic}?`,
    pick(r, [`One date keeps coming back in this story, ${y}.`, `Everything seems to hinge on a single date, ${y}.`]),
    `A single figure, ${n}, makes the answer much less obvious than it looks.`,
    'So what really happened?'
  ],
  payoff: 'So here is the answer to the opening question, the facts put back in order already tell most of the story.'
}

/** Sentences of exactly `n` words (n >= 1), built from the closers; falls back on two sentences when no one fits. */
export function fitSentences(bank: Pick<Bank, 'closers'>, n: number, r: Rnd): string[] {
  if (n <= 0) return []
  const byLen = new Map<number, string[]>()
  for (const c of bank.closers) {
    const k = countWords(c)
    byLen.set(k, [...(byLen.get(k) ?? []), c])
  }
  const exact = byLen.get(n)
  if (exact) return [pick(r, exact)]
  const lens = [...byLen.keys()].sort((a, b) => b - a)
  // split n into the largest available sentence and the rest
  for (const a of lens) {
    if (a < n && (n - a === 0 || byLen.has(n - a) || n - a > 16)) {
      const first = pick(r, byLen.get(a) ?? [])
      return [first, ...fitSentences(bank, n - a, r)]
    }
  }
  return []
}

/** One body sentence of 8..16 words made of a subject, a verb phrase and an optional tail. */
function bodySentence(bank: Bank, r: Rnd, maxWords: number): string | null {
  for (let i = 0; i < 60; i++) {
    const tail = r() < 0.6 ? ` ${pick(r, bank.tails)}` : ''
    const s = `${pick(r, bank.subjects)} ${pick(r, bank.verbs)}${tail}.`
    const n = countWords(s)
    if (n >= 8 && n <= Math.min(16, maxWords)) return s
  }
  return null
}

const figureSentence = (bank: Bank, r: Rnd, y: number, n: number): string =>
  pick(r, bank.figures).replace('{y}', String(y)).replace('{n}', String(n))

/** The demo narration: exactly `words` words by `countWords`, paragraphs separated by a blank line. With `objects`, the hook and
 *  the opening handle the reference's things at its measured rate (moteur-pov-2). */
export function fakeScript(o: { topic: string; language: string; words: number; seed: number; objects?: DemoObjects; address?: 'you' | 'we' | 'i' | 'neutral' }): string {
  // a channel that tells its stories to « you » gets a story's sentences (places, reactions, amounts), not a lecture's
  const story = o.address === 'you' ? STORY[o.language === 'fr' ? 'fr' : 'en'] : null
  let storyTurn = 0
  const storyLine = (r: () => number): string => {
    // a story is mostly places lived, a reaction now and then, an amount rarely (two figures in a row read as a lecture)
    const k = storyTurn++ % 9
    const list = k === 6 ? story!.amounts : k === 2 ? story!.reactions : k === 4 ? story!.jumps : k === 8 ? story!.questions : story!.scenes
    return list[Math.floor(r() * list.length) % list.length]!.replace('{n}', String(2 + Math.floor(r() * 240)))
  }
  const bank0 = o.language === 'fr' ? FR : EN
  const bank: Bank = story ? { ...bank0, closers: [...bank0.closers.filter((c) => !/dossier|récit|story|record/i.test(c))] } : bank0
  const r = seededRandom(o.seed + 7919)
  const year = 1500 + Math.floor(r() * 450)
  const num = 3 + Math.floor(r() * 90)
  const things = o.objects && o.objects.objects.length > 0 ? o.objects : null
  // the things in turn, the most frequent ones more often (weighted by their measured share)
  let turn = 0
  const nextThing = (): { hold: DemoHold; detail: DemoDetail } => {
    const list = things!.objects
    const weights = list.map((x) => Math.max(0.05, x.share))
    const sum = weights.reduce((a, b) => a + b, 0)
    let at = ((turn++ * 0.618) % 1) * sum
    for (const [k, w] of weights.entries()) { if (at < w) return list[k]!; at -= w }
    return list[0]!
  }
  const hook = things
    ? [
        o.language === 'fr' ? `Imagine un instant : ${o.topic}.` : `Picture this for a moment: ${o.topic}.`,
        objectSentence(o.language, things.objects[0]!, r),
        objectSentence(o.language, things.objects[1] ?? things.objects[0]!, r),
        o.language === 'fr' ? 'Et maintenant, que fais-tu ?' : 'So what do you do now?'
      ]
    : bank.hook(o.topic, year, num, r)
  const hookWords = countWords(hook.join(' '))
  const payWords = countWords(bank.payoff)
  const W = Math.max(1, Math.round(o.words))
  if (W < hookWords + payWords + 21) return fitSentences(bank, W, r).join(' ')
  const closeFill = 12 + Math.floor(r() * 10)
  let rem = W - hookWords - payWords - closeFill
  const body: string[] = []
  let sinceFigure = 0
  let said = hookWords
  let handled = 0
  while (rem >= 8) {
    let s: string | null = null
    // a thing handled at the measured rate (the opening's, then the body's)
    if (things) {
      const share = said < things.openingWords ? things.openingShare : things.bodyShare
      if (share > 0 && handled < (body.length + 1) * share) {
        const c = objectSentence(o.language, nextThing(), r)
        if (countWords(c) <= rem && (rem - countWords(c) === 0 || rem - countWords(c) >= 8)) {
          s = c
          handled++
        }
      }
    }
    if (!s && story) {
      for (let k = 0; k < 8 && !s; k++) {
        const c = storyLine(r)
        if (countWords(c) <= rem && (rem - countWords(c) === 0 || rem - countWords(c) >= 8)) s = c
      }
      if (!s) {
        const c = bodySentence(bank, r, rem)
        if (c && (rem - countWords(c) === 0 || rem - countWords(c) >= 8)) s = c
      }
    }
    if (!s && (body.length === 1 || sinceFigure >= 9)) {
      const f = figureSentence(bank, r, year + body.length, num + body.length)
      if (countWords(f) <= rem && (rem - countWords(f) === 0 || rem - countWords(f) >= 8)) {
        s = f
        sinceFigure = 0
      }
    }
    if (!s) {
      for (let k = 0; k < 40 && !s; k++) {
        const c = bodySentence(bank, r, rem)
        if (c && (rem - countWords(c) === 0 || rem - countWords(c) >= 8)) s = c
      }
    }
    if (!s) break
    body.push(s)
    sinceFigure++
    rem -= countWords(s)
    said += countWords(s)
  }
  const tail = fitSentences(bank, rem, r)
  const paraCount = Math.max(2, Math.round(body.length / 4))
  const paras: string[] = [hook.join(' ')]
  const per = Math.ceil(body.length / paraCount)
  for (let i = 0; i < body.length; i += per) paras.push(body.slice(i, i + per).join(' '))
  if (tail.length > 0) {
    if (paras.length > 1) paras[paras.length - 1] += ` ${tail.join(' ')}`
    else paras.push(tail.join(' '))
  }
  paras.push([bank.payoff, ...fitSentences(bank, closeFill, r)].join(' '))
  return paras.join('\n\n')
}
