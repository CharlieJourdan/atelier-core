// Screens of the Production area. Production rebuilt (production-2, decisions 0008, 0010, 0011): no pre-made pipeline and
// no demo data. The page ids stay (other screens route to them): `apercu` and `nouvelle` are the Lab (production-lab:
// « Créer une pipeline », « Nouvelle vidéo », « Mes pipelines », « Pipelines prêtes »), `pretes` every ready pipeline,
// `pipeline` and `editeur` the recipe editor by stage,
// `agent` the pipeline agent's four ways in and its proposal (production-12), `style` « Reproduire un style » (production-15), `bibliotheque` the projects, `ressources` the technologies panel; `encours` is the engine's runs, unchanged. This map is
// spread after the other areas' maps, so it wins on `production/pipeline` and `production/ressources`.
// idees, automatisations: screens/ideas; chaines, analyser, builder: screens/analysis.
import type { ScreenMap } from '../registry'
import { AgentStart } from './agent/AgentStart'
import { EnCoursScreen } from './encours/EnCoursScreen'
import { LabScreen } from './lab/LabScreen'
import { ReadyScreen } from './lab/ReadyScreen'
import { ProjectsScreen } from './recettes/ProjectsScreen'
import { RecipeEditor } from './recettes/RecipeEditor'
import { TechnologiesPanel } from './recettes/TechnologiesPanel'
import { StyleStudio } from './style/StyleStudio'
import { CreationScreen } from './creation/CreationScreen'

export const PRODUCTION_SCREENS: ScreenMap = {
  'production/apercu': LabScreen,
  'production/nouvelle': LabScreen,
  'production/pretes': ReadyScreen,

  'production/pipeline': RecipeEditor,
  'production/editeur': RecipeEditor,
  'production/bibliotheque': ProjectsScreen,
  'production/ressources': TechnologiesPanel,
  'production/encours': EnCoursScreen,
  'production/agent': AgentStart,
  'production/style': StyleStudio,
  'production/creer': CreationScreen
}
