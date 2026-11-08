// Demo handlers: lab (see handlers.ts). Production's pipelines and their editor, the ready pipelines, Ressources, Outils,
// Idées, Automatisations, Builder, Chaînes / Analyser and « Reproduire un style », one domain per api-lab-*.ts file.
import type { DemoHandlers } from './bridge'
import { analysisHandlers } from './api-lab-analysis'
import { estimatesHandlers } from './api-lab-estimates'
import { ideasHandlers } from './api-lab-ideas'
import { libraryHandlers } from './api-lab-library'
import { recipesHandlers } from './api-lab-recipes'
import { styleHandlers } from './api-lab-style'
import { toolsHandlers } from './api-lab-tools'

export const labHandlers: DemoHandlers = {
  ...recipesHandlers,
  ...estimatesHandlers,
  ...libraryHandlers,
  ...analysisHandlers,
  ...ideasHandlers,
  ...toolsHandlers,
  ...styleHandlers
}
