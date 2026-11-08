// Entry of the clickable web demo (`npm run demo:web`, `npm run demo:web:build` → dist-demo/): the same React app as the
// desktop, on the in-browser demo bridge, under a thin « Démo — données fictives » band.
import { createDemoBridge } from './bridge'
import { demoHandlers } from './handlers'
import { applyDemoPersona } from './persona'
import { prepareVisit } from './visit'

window.atelier = createDemoBridge(demoHandlers())
prepareVisit()
applyDemoPersona()

void import('./mount')
