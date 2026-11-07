// electron-builder config of Atelier for Charlie's Mac (Apple Silicon): `npm run dist:mac` on the Mac.
// Targets `dir` (dist/mac/mac-arm64/Atelier.app) and `dmg`, arm64 only. No Developer ID: electron-builder's own
// signing is off and the app is signed ad hoc (`codesign --sign -`) right after packing, before the dmg is made.
// Apple Silicon refuses to run unsigned code, and packing changes Info.plist, which breaks Electron's own signature.
// Built on the Mac itself, so there is no quarantine flag and Gatekeeper lets it open.
// The engine is never bundled: Atelier points at ~/dev/atelier-engine (Settings), plan §8.1.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { base } from './electron-builder.config.mjs'

/** Ad-hoc signature of the packed .app (macOS only; a no-op elsewhere so the config can be loaded by tests). */
export function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
}

/** @type {import('electron-builder').Configuration} */
export default {
  ...base,
  directories: { output: 'dist/mac' },
  mac: {
    target: [{ target: 'dir', arch: 'arm64' }, { target: 'dmg', arch: 'arm64' }],
    category: 'public.app-category.productivity',
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    minimumSystemVersion: '13.0',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Atelier utilise le micro pour la dictée dans les conversations.',
      LSApplicationCategoryType: 'public.app-category.productivity'
    }
  },
  dmg: { artifactName: 'Atelier-${version}-arm64.${ext}' },
  afterPack: adhocSign
}
