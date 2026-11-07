import { Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { trayBitmap, usesTemplateTrayIcon } from '../platform/chrome'

/**
 * The tray (Windows) / menu-bar (macOS) icon, drawn in code. macOS gets a template image at 1x and 2x so it stays
 * sharp on Retina and follows the light/dark menu bar.
 */
function trayImage(platform: NodeJS.Platform = process.platform): NativeImage {
  const one = trayBitmap(platform, 16)
  const image = nativeImage.createFromBitmap(one.buffer, { width: 16, height: 16, scaleFactor: 1 })
  if (usesTemplateTrayIcon(platform)) {
    const two = trayBitmap(platform, 32)
    image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: two.buffer })
    image.setTemplateImage(true)
  }
  return image
}

export function createTray(handlers: { show: () => void; quit: () => void }): Tray {
  const tray = new Tray(trayImage())
  tray.setToolTip('Atelier')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Afficher Atelier', click: handlers.show },
      { type: 'separator' },
      { label: 'Quitter Atelier', click: handlers.quit }
    ])
  )
  // Windows: a left click shows the window. macOS opens the menu on click (the Dock icon shows the window).
  if (process.platform !== 'darwin') tray.on('click', handlers.show)
  return tray
}
