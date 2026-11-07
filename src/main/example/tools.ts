// Example workspace rows of the "tools" area (lot Z1): three tools (one ready, one with a missing secret so it shows an
// error, one disabled) with a few dry runs. Rows are marked example = 1; `clear` deletes them (versions and runs follow).
import type { Db } from '../db'
import { SecretsStore } from '../secrets'
import { ToolsStore, secretKey } from '../tools/store'
import type { ExampleArea } from './types'

const VOICE = {
  id: 'voix-maison',
  name: 'Voix maison (exemple)',
  version: '1.2.0',
  kind: 'command',
  description: 'Lit un script et renvoie audio.mp3 avec une voix locale.',
  entry: { command: 'python3', args: ['voix_maison/cli.py', '--vitesse', '{{vitesse}}'] },
  inputs: [
    { name: 'script', type: 'string', required: true, description: 'Texte à lire' },
    { name: 'vitesse', type: 'number', description: 'Vitesse de lecture', default: 1 }
  ],
  outputs: [{ name: 'audio', type: 'file', description: 'audio.mp3' }],
  permissions: { fs: { read: ['$TOOL_DIR'], write: ['$OUTPUT_DIR'] }, network: [], env: [] },
  expose: {
    agents: ['voiceover'],
    production: {
      slot: 'narration',
      ports: [
        { name: 'script', type: 'text', direction: 'in' },
        { name: 'audio', type: 'audio', direction: 'out' }
      ]
    }
  }
}

const SEARCH = {
  id: 'recherche-web',
  name: 'Recherche web (exemple)',
  version: '0.3.1',
  kind: 'http',
  description: 'Interroge un service de recherche et renvoie les premiers résultats.',
  entry: {
    url: 'https://api.recherche-exemple.fr/v1/search?q={{requete}}',
    method: 'GET',
    headers: { Authorization: 'Bearer {{secret:SEARCH_API_KEY}}' }
  },
  inputs: [{ name: 'requete', type: 'string', required: true, description: 'Mots à chercher' }],
  outputs: [{ name: 'resultats', type: 'json', description: 'Liste de résultats' }],
  permissions: { network: ['api.recherche-exemple.fr'] },
  secrets: ['SEARCH_API_KEY'],
  expose: { agents: ['researcher'] }
}

const CONVERTER = {
  id: 'convertisseur-ffmpeg',
  name: 'Convertisseur ffmpeg (exemple)',
  version: '2.0.0',
  kind: 'script',
  description: 'Convertit un fichier média vers un autre format.',
  entry: { command: 'ffmpeg', args: ['-i', '{{entree}}', '{{sortie}}'] },
  inputs: [
    { name: 'entree', type: 'file', required: true, description: 'Fichier à convertir' },
    { name: 'sortie', type: 'string', required: true, description: 'Nom du fichier produit' }
  ],
  permissions: { fs: { read: ['$INPUT_FILES'], write: ['$OUTPUT_DIR'] } }
}

/** Only `has` is used while seeding (no secret is written), so a cipher that is never available is enough. */
const noCipher = { isAvailable: () => false, encrypt: () => new Uint8Array(), decrypt: () => '' }

export const toolsExample: ExampleArea = {
  name: 'tools',
  seed: (db: Db) => {
    const store = new ToolsStore(db, new SecretsStore(db, noCipher), () => [])
    for (const manifest of [VOICE, SEARCH, CONVERTER]) store.add(JSON.stringify(manifest), true)
    store.setEnabled(CONVERTER.id, false)
    const agents = db.prepare('UPDATE tools SET granted_agents_json = ? WHERE slug = ?')
    agents.run(JSON.stringify(['voiceover', 'supervisor']), VOICE.id)
    agents.run(JSON.stringify(['researcher']), SEARCH.id)
    store.dryRun(VOICE.id, { script: 'Bonjour, ceci est un test de voix.', vitesse: 1.1 })
    store.dryRun(VOICE.id, { script: 'Deuxième essai, plus lent.', vitesse: 0.9 })
    store.dryRun(SEARCH.id, { requete: 'triangle des Bermudes' })
    db.prepare('UPDATE tool_runs SET example = 1 WHERE tool IN (?, ?, ?)').run(VOICE.id, SEARCH.id, CONVERTER.id)
  },
  clear: (db: Db) => {
    db.prepare('DELETE FROM tool_runs WHERE example = 1').run()
    db.prepare('DELETE FROM tool_versions WHERE tool IN (SELECT slug FROM tools WHERE example = 1)').run()
    // Secret values (tools.<slug>.<NAME>) live in `secrets`: delete them with the rows.
    const rows = db.prepare('SELECT slug, secrets_json FROM tools WHERE example = 1').all() as { slug: string; secrets_json: string }[]
    for (const r of rows) {
      for (const n of JSON.parse(r.secrets_json) as string[]) db.prepare('DELETE FROM secrets WHERE name = ?').run(secretKey(r.slug, n))
    }
    db.prepare('DELETE FROM tools WHERE example = 1').run()
  }
}
