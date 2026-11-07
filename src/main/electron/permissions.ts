// Session permissions of the app window. Atelier embeds no third-party page (no <webview>): the window is created
// without the webview tag, and any attach attempt is refused as well (defence in depth).
import { session, type BrowserWindow } from 'electron'

/** The app itself needs no permission (camera, notifications, ...): the default session refuses them all. */
export function denyDefaultSessionPermissions(): void {
  const main = session.defaultSession
  main.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  main.setPermissionCheckHandler(() => false)
}

/** Refuses every <webview> the page might try to attach. */
export function refuseWebviews(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}
