// Screens of lot Z1 owned by this area: monetisation. Proto refresh: the route opens the readable profit and loss; the
// previous six-tab `MoneyScreen` is still there, shown in place by its « Avancé » toggle.
import type { ScreenMap } from '../registry'
import { MoneyProtoScreen } from './proto/MoneyProtoScreen'

export const MONEY_SCREENS: ScreenMap = { monetisation: MoneyProtoScreen }
