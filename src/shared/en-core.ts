// English strings of the inline keys of fr.ts (shell chrome, palette, gallery, errors).
// section.* and page.production.* live in en-p-shell.ts.
import type { MessageKey } from './fr'

export const enCore: Partial<Record<MessageKey, string>> = {
  'app.name': 'Atelier',

  // Empty section pages
  'empty.accueil.title': 'Your dashboard is on its way',
  'empty.accueil.blurb': 'Production, team and money will live here, at a glance.',
  'empty.conversations.title': 'No conversations yet',
  'empty.conversations.blurb': 'The Supervisor, group rooms and direct messages will show up here.',
  'empty.production.title': 'The production room is empty',
  'empty.production.blurb': 'Compose a video, follow renders and tidy the library: it all happens here.',
  'empty.validations.title': 'Nothing to approve',
  'empty.validations.blurb': 'Scripts, voices, thumbnails and renders waiting for your decision will land here.',
  'empty.agents.title': 'The team has not been introduced yet',
  'empty.agents.blurb': 'Each agent will get a profile: status, model, memory, routines.',
  'empty.ordinateurs.title': 'No screen open',
  'empty.ordinateurs.blurb': 'Agent browsers and remote machines are controlled from here.',
  'empty.monetisation.title': 'No numbers yet',
  'empty.monetisation.blurb': 'Revenue, sponsors, costs and profit per channel will appear here.',
  'empty.outils.title': 'No tool connected',
  'empty.outils.blurb': 'Connect your own scripts, services and MCP servers, described by a manifest.',
  'empty.reglages.title': 'Settings',
  'empty.reglages.blurb': 'This page will be filled in a later release.',
  'empty.page.title': 'Page in progress',
  'empty.page.blurb': 'Navigation is in place; the content comes later.',

  // Sub-pages (context column)
  'page.reglages.general': 'General',
  'page.reglages.compte': 'Account and credits',
  'page.reglages.equipe': 'Team',
  'page.reglages.claude': 'Claude and models',
  'page.reglages.cloud': 'Atelier Cloud',
  'page.reglages.moteur': 'Engine',
  'page.reglages.budgets': 'Budgets and execution',
  'page.reglages.chaines': 'Channels',
  'page.reglages.notifications': 'Notifications and sounds',
  'page.reglages.audio': 'Audio',
  'page.reglages.apparence': 'Appearance',
  'page.reglages.fonctions': 'Features (live / demo)',
  'page.reglages.donnees': 'Data',
  'page.reglages.admin': 'Platform admin',
  'page.reglages.apropos': 'About',
  'page.reglages.galerie': 'Gallery (dev)',

  // Chrome
  'shell.rail': 'Main navigation',
  'shell.context': 'Section pages',
  'shell.logo': 'Atelier, home',
  'shell.profile': 'Profile',
  'shell.palette': 'Search and act',
  'shell.paletteKey': '⌘K',
  'shell.collapse': 'Collapse the column',
  'shell.expand': 'Expand the column',
  'engine.ok': 'Engine ready',
  'engine.warn': 'Engine busy or incomplete',
  'engine.err': 'Engine error',
  'engine.off': 'Engine stopped',
  'theme.toDark': 'Switch to dark theme',
  'theme.toLight': 'Switch to light theme',
  'theme.dark': 'Dark',
  'theme.light': 'Light',

  // Command palette
  'palette.title': 'Command palette',
  'palette.placeholder': 'Go to a section, run an action…',
  'palette.empty': 'No matches.',
  'palette.group.navigation': 'Navigation',
  'palette.group.pages': 'Pages',
  'palette.group.actions': 'Actions',
  'palette.action.theme': 'Toggle light / dark',
  'palette.action.gallery': 'Open the component gallery',

  // Confirmation and toasts
  'confirm.cancel': 'Cancel',
  'confirm.confirm': 'Confirm',
  'toast.close': 'Dismiss notification',
  'demo.nothingDone': 'Demo: nothing was done.',

  // Demo
  'demo.badge': 'DEMO',
  'demo.boundary': 'What this would look like. Nothing is sent.',
  'demo.unlock': 'To turn it on: {how}',
  'feature.real': 'Live',
  'feature.demo': 'Demo',
  'feature.needsCredits': 'Not enough credits',

  // Legacy

  // Gallery
  'gallery.title': 'Component gallery',
  'gallery.blurb': 'The whole design system on one page: tokens, in-house components, shadcn and ElevenLabs UI.',
  'gallery.tokens': 'Tokens',
  'gallery.buttons': 'Buttons',
  'gallery.atelier': 'Atelier components',
  'gallery.feedback': 'Feedback: toasts and confirmation',
  'gallery.elevenlabs': 'ElevenLabs UI',
  'gallery.toastOk': 'Show a toast',
  'gallery.toastDemo': 'Demo toast',
  'gallery.confirm': 'Open the confirmation',
  'gallery.confirmTitle': 'Delete this video?',
  'gallery.confirmBody': 'The working folder stays on disk, but the video disappears from the list.',
  'gallery.confirmAction': 'Delete',
  'gallery.confirmed': 'Confirmed',
  'gallery.cancelled': 'Cancelled',
  'gallery.orb': 'Orb',
  'gallery.shimmer': 'Shimmering Text',
  'gallery.shimmerText': 'Reading the engine queue…',
  'gallery.audio': 'Audio Player',
  'gallery.waveform': 'Waveform',

  // Atelier components
  'state.working': 'Working',
  'state.waiting': 'Waiting',
  'state.blocked': 'Blocked',
  'state.idle': 'Idle',
  'state.done': 'Done',
  'state.error': 'Error',
  'empty.generic': 'Nothing to show yet.',
  'loading': 'Loading…',

  // Vendored audio components (aria labels)
  'audio.play': 'Play',
  'audio.pause': 'Pause',
  'audio.speed': 'Playback speed',
  'audio.speedControls': 'Choose playback speed',
  'audio.scrubber': 'Waveform, click to seek',
  'audio.scrubRecording': 'Drag to scrub the recording',

  'production.pending':
    'the production engine is not available yet, so editing is not done automatically. Drop it in yourself on the video page, or wait for the new Production.',

  // The local-folder rule
  'folder.absolute': 'The folder must be an absolute path',
  'folder.missing': 'The folder does not exist: {dir}',
  'folder.network': 'The folder must be on a local drive (like C:\\dev\\atelier-work), not a network path',
  'folder.leadsToNetwork': 'The folder points to a network path ({real}): choose a local folder',
  'folder.notHome': 'The folder must be inside your home folder (like ~/dev/atelier-work), not {real}',

  // Spend: history of the renders made by the old engine
  'oldRenders.title': 'Past renders',
  'oldRenders.empty': 'No past renders.',
  'oldRenders.date': 'Date',
  'oldRenders.video': 'Video',
  'oldRenders.state': 'Status',
  'oldRenders.cost': 'Cost',
  'oldRenders.untitled': 'Untitled render',
  'oldRenders.state.queued': 'Queued',
  'oldRenders.state.running': 'In progress',
  'oldRenders.state.downloading': 'Downloading',
  'oldRenders.state.done': 'Done',
  'oldRenders.state.error': 'Failed',
  'oldRenders.state.cancelled': 'Cancelled',
  'oldRenders.state.unknown': 'Unknown',

  // Errors
  'error.title': 'Something went wrong',
  'error.retry': 'Try again',
  'error.crash.body': 'The screen ran into a problem. Your data is safe: reload the screen to carry on.',
  'error.crash.reload': 'Reload the screen'
}
