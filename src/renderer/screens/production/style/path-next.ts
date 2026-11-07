// Which way into « Créer une pipeline » the style screen opens on (a route has no parameter): the Lab's dialog sets it before
// routing, the screen takes it once on mount (parcours-utilisateur).
import type { StudyPath } from '../../../../shared/style-agent'

let wanted: StudyPath | null = null

export function openStudyNext(path: StudyPath): void {
  wanted = path
}

export function takeStudyPath(): StudyPath | null {
  const p = wanted
  wanted = null
  return p
}
