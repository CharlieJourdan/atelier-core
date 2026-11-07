// Réglages pages on the existing settings APIs (lot Z1): general, moteur, budgets, chaines, notifications, discord, ordinateur (team computer link), audio,
// apparence, fonctions, donnees, apropos.
import type { ScreenMap } from '../../registry'
import { AboutPage } from './AboutPage'
import { AdvancedPage } from './AdvancedPage'
import { AppearancePage } from './AppearancePage'
import { AudioPage } from './AudioPage'
import { BrainPage } from './BrainPage'
import { BudgetsPage } from './BudgetsPage'
import { ChannelsPage } from './ChannelsPage'
import { DataPage } from './DataPage'
import { DiscordPage } from './DiscordPage'
import { EnginePage } from './EnginePage'
import { FeaturesPage } from './FeaturesPage'
import { GeneralPage } from './GeneralPage'
import { NotificationsPage } from './NotificationsPage'

export const PREFS_SCREENS: ScreenMap = {
  'reglages/general': GeneralPage,
  'reglages/moteur': EnginePage,
  'reglages/budgets': BudgetsPage,
  'reglages/chaines': ChannelsPage,
  'reglages/notifications': NotificationsPage,
  'reglages/discord': DiscordPage,
  'reglages/ordinateur': BrainPage,
  'reglages/audio': AudioPage,
  'reglages/apparence': AppearancePage,
  'reglages/fonctions': FeaturesPage,
  'reglages/donnees': DataPage,
  'reglages/avance': AdvancedPage,
  'reglages/apropos': AboutPage
}
