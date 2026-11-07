// The blind listening test (production-5, pipeline-avatar §2.3: « a blind listening test (French first) decides which one
// runs »): the same 30-second French text, spoken by the channel voice on each engine, written as A, B, C… in a shuffled
// order, with a sheet to fill (`fiche.txt`) and the key apart (`cle.json`), so Charlie judges without knowing which engine
// is which. The order comes from a seed, so a test can be made again identically.
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** About 30 seconds of French narration (≈ 75 words at the channel's 150–180 words per minute), numbers and names included. */
export const BLIND_TEXT_FR =
  'En 1912, le Titanic quitte Southampton avec plus de deux mille passagers. Personne ne croit qu’il puisse couler. ' +
  'Pourtant, quatre jours plus tard, à vingt-trois heures quarante, la vigie aperçoit un iceberg droit devant. ' +
  'L’officier donne l’ordre de virer à bâbord, mais il est déjà trop tard. ' +
  'Ce qui s’est vraiment passé cette nuit-là, on ne l’a compris que soixante-dix ans plus tard.'

export interface BlindEntry {
  engine: string
  /** Writes the narration of `text` into `out` (without extension); returns the file written. */
  render: (text: string, out: string) => Promise<string>
}

/** A deterministic shuffle of `n` items from `seed` (Fisher–Yates on a hash stream). */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const h = createHash('sha256').update(`${seed}:${i}`).digest()
    const j = h.readUInt32BE(0) % (i + 1)
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

/** Writes the test into `dir`: one file per engine named by a letter, the sheet, and the key. */
export async function makeBlindTest(o: { dir: string; entries: readonly BlindEntry[]; seed: string; text?: string }): Promise<{ files: string[]; key: Record<string, string> }> {
  if (o.entries.length < 2) throw new Error('Le test à l’aveugle demande la voix sur au moins deux moteurs.')
  if (o.entries.length > 26) throw new Error('Le test à l’aveugle prend au plus 26 moteurs.')
  await mkdir(o.dir, { recursive: true })
  const text = o.text ?? BLIND_TEXT_FR
  const order = shuffled(o.entries, o.seed)
  const files: string[] = []
  const key: Record<string, string> = {}
  for (const [i, e] of order.entries()) {
    const letter = String.fromCharCode(65 + i)
    const file = await e.render(text, path.join(o.dir, letter))
    files.push(path.basename(file))
    key[letter] = e.engine
  }
  const sheet = [
    'Test d’écoute à l’aveugle — voix de la chaîne',
    '',
    `Écoute ${files.join(', ')} (le même texte). Ne regarde pas cle.json avant d’avoir noté.`,
    'Note chaque fichier de 1 à 5 : naturel, prononciation du français, chiffres et noms, envie d’écouter 10 minutes.',
    '',
    ...files.map((f) => `${f} : naturel __ / prononciation __ / chiffres __ / envie __   remarque : `),
    '',
    `Texte lu : ${text}`
  ].join('\n')
  await writeFile(path.join(o.dir, 'fiche.txt'), sheet, 'utf8')
  await writeFile(path.join(o.dir, 'cle.json'), JSON.stringify({ seed: o.seed, key }, null, 2), 'utf8')
  return { files, key }
}
