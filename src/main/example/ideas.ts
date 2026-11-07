// Example workspace rows of the "ideas" area (lot Z1): ideas for both example channels and two automations.
import type { ExampleArea } from './types'

const IDEAS: readonly { channel: 'documentary' | 'top10'; title: string; angle: string; source: 'manual' | 'agent'; score: number | null; status: string }[] = [
  { channel: 'documentary', title: 'Le Masque de fer : qui était vraiment le prisonnier ?', angle: 'Les six hypothèses confrontées aux registres de la Bastille.', source: 'agent', score: 82, status: 'kept' },
  { channel: 'documentary', title: 'Les catacombes de Paris, une ville sous la ville', angle: 'Des carrières médiévales aux ossuaires : 300 km de galeries racontés.', source: 'agent', score: 74, status: 'new' },
  { channel: 'documentary', title: 'Le naufrage du Mary Celeste', angle: 'Un navire retrouvé intact et vide : ce que disent les rapports de 1872.', source: 'manual', score: null, status: 'new' },
  { channel: 'documentary', title: 'La cité perdue de Z', angle: 'L’expédition Fawcett et ce que la forêt a révélé depuis.', source: 'agent', score: 58, status: 'rejected' },
  { channel: 'top10', title: '10 records du monde impossibles à battre', angle: 'Chaque record avec son chiffre et pourquoi il tient encore.', source: 'agent', score: 77, status: 'kept' },
  { channel: 'top10', title: '10 erreurs historiques qui ont tout changé', angle: 'Des fautes de calcul aux mauvaises cartes : les conséquences en chiffres.', source: 'agent', score: 69, status: 'new' }
]

export const ideasExample: ExampleArea = {
  name: 'ideas',
  seed: (db, seed) => {
    const insert = db.prepare('INSERT INTO ideas (channel_id, title, angle, source, score, status, example) VALUES (?, ?, ?, ?, ?, ?, 1)')
    for (const i of IDEAS) insert.run(seed.channels[i.channel], i.title, i.angle, i.source, i.score, i.status)
    // The idea behind an example video already created from it.
    db.prepare("INSERT INTO ideas (channel_id, title, angle, source, score, status, video_id, example) VALUES (?, ?, ?, 'agent', 80, 'used', ?, 1)").run(
      seed.channels.documentary,
      'Toutânkhamon : la malédiction mise à l’épreuve',
      'Les morts « mystérieuses » une à une, avec les dates et les causes connues.',
      seed.videos.toutankhamon
    )
    const now = new Date()
    const auto = db.prepare(
      `INSERT INTO automations (name, channel_id, cadence, weekday, hour, topic_from, topic, minutes, budget_mode, gate_mode, enabled, last_run_at, next_run_at, example)
       VALUES (?, ?, 'weekly', ?, ?, ?, ?, ?, 'usage_max', 'step', ?, ?, ?, 1)`
    )
    const monday = auto.run(
      'Documentaire du lundi',
      seed.channels.documentary,
      1,
      9,
      'ideas',
      '',
      8,
      0,
      new Date(now.getTime() - 3 * 86_400_000).toISOString(),
      null
    )
    auto.run('Top 10 du jeudi', seed.channels.top10, 4, 18, 'fixed', '10 inventions oubliées', 6, 0, null, null)
    db.prepare("INSERT INTO automation_runs (automation_id, video_id, status, message, example, created_at) VALUES (?, ?, 'started', ?, 1, ?)").run(
      Number(monday.lastInsertRowid),
      seed.videos.templiers,
      'Vidéo « Le trésor des Templiers a-t-il existé ? » lancée.',
      new Date(now.getTime() - 3 * 86_400_000).toISOString()
    )
  },
  clear: (db) => {
    db.prepare('DELETE FROM automation_runs WHERE example = 1').run()
    db.prepare('DELETE FROM automations WHERE example = 1').run()
    db.prepare('DELETE FROM ideas WHERE example = 1').run()
  }
}
