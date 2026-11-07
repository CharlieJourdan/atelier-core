// electron-builder config of Atelier, Windows (H1). The Mac build is electron-builder.mac.config.mjs (same base).
// NSIS per-user installer (no admin rights) plus the unpacked `dir` output. No code signing. The app updates itself from
// Atelier Cloud's update feed (electron-updater, src/main/updater; docs/RELEASES.md): nothing is published by electron-builder,
// `npm run release` uploads the installer to the Cloud. One app since v2 (the v1 build flavours are gone); since lot P1 no external engine is used or packed.

/** @type {import('electron-builder').Configuration} */
export const base = {
  appId: 'fr.charlie.atelier',
  productName: 'Atelier',
  executableName: 'Atelier',
  copyright: 'Charlie Jourdan',
  files: ['out/**/*', 'package.json'],
  // Claude Code starts out/main/mcp.js (and the chunk it requires) with Electron's binary as Node: a child
  // process needs a real file path, not a path inside app.asar.
  // The local worker (out/main/worker.js, lot P5) is started the same way; it requires zod, which must then be
  // found next to it (app.asar.unpacked/node_modules), not inside the archive.
  asarUnpack: ['out/main/mcp.js', 'out/main/worker.js', 'out/main/chunks/**', 'node_modules/zod/**'],
  // Atelier's own resources the engine reads at run time (fonts, music, script skills), at
  // <resourcesPath>/resources/… (see resourcesDirFor in src/main/production/local-worker.ts). Not the test media nor
  // the published schemas.
  extraResources: [
    { from: 'resources/fonts', to: 'resources/fonts' },
    { from: 'resources/music', to: 'resources/music' },
    // the editing kit's sound effects (motion-montage: recorded CC0 / CC BY, credits in resources/sfx/CREDITS.md)
    { from: 'resources/sfx', to: 'resources/sfx' },
    // the documentary maps' Earth and borders (style-markets: NASA Blue Marble, Natural Earth, public domain)
    { from: 'resources/maps', to: 'resources/maps' },
    { from: 'resources/skills', to: 'resources/skills' },
    { from: 'resources/previews', to: 'resources/previews' },
    { from: 'resources/option-previews', to: 'resources/option-previews' }
  ],
  // The generic provider only makes electron-builder write resources/app-update.yml (electron-updater reads its cache folder
  // name from it). The app overrides the address at run time (setFeedURL: the Cloud the app is connected to, the channel the
  // person chose), and electron-builder never publishes by itself (no --publish flag, no tag).
  publish: { provider: 'generic', url: 'http://127.0.0.1:8787/v1/updates/beta/win', channel: 'latest' },
  npmRebuild: false
}

/** @type {import('electron-builder').Configuration} */
export default {
  ...base,
  directories: { output: 'dist/win' },
  win: { target: [{ target: 'nsis', arch: 'x64' }, { target: 'dir', arch: 'x64' }], signAndEditExecutable: false },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    artifactName: 'Atelier-Setup-${version}.${ext}'
  }
}
