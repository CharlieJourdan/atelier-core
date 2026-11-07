// English strings of the app's self-update (keys of fr-update.ts).
import type { MessageKey } from './fr'

export const enUpdate: Partial<Record<MessageKey, string>> = {
  'update.err.notReady': 'No downloaded update to install yet.',
  'update.err.busy': 'A check or a download is running: wait for it to finish before changing channel.',
  'update.err.channel': 'Unknown channel: choose “beta” or “stable”.',
  'update.err.check': 'Checking for updates failed: {reason}',

  'update.title': 'Updates',
  'update.current': 'Installed version',
  'update.channel': 'Channel',
  'update.channel.hint': 'Beta: new versions arrive first, for the testers. Stable: only versions that have proven themselves.',
  'update.channel.beta': 'Beta',
  'update.channel.stable': 'Stable',
  'update.check': 'Check for updates',
  'update.checking': 'Checking…',
  'update.upToDate': 'Atelier is up to date.',
  'update.lastCheck': 'Last check: {when}',
  'update.never': 'Not checked yet since the app started.',
  'update.downloading': 'Downloading version {version}: {percent}%',
  'update.ready': 'Version {version} is ready to install.',
  'update.install': 'Restart to install',
  'update.installLater': 'Otherwise it installs by itself when you close Atelier.',
  'update.notes': 'What’s new in version {version}',
  'update.error': 'The last check failed: {reason}',
  'update.schedule': 'Atelier looks for an update at start-up, then every 4 hours, and downloads it in the background.',
  'update.unsupported.dev': 'This development build does not update itself: only the installed app does.',
  'update.unsupported.platform': 'This system does not allow automatic updates: download the new version by hand.',
  'update.unsupported.headless': 'This program (the team computer’s brain) does not update from this screen.',
  'update.help.win': 'On Windows the installer is not signed: Windows may show a SmartScreen warning (“More info”, then “Run anyway”). The update is verified by a checksum and works without a signature.',
  'update.help.mac': 'On Mac, automatic updates need an app signed by an Apple developer account. Without a signature, download the new version by hand.',
  'update.feed': 'Update feed'
}
