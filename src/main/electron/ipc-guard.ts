// Pure checks for the IPC bus and for links (no Electron import, so they are unit-tested under plain Node).

export interface TrustedWindow {
  webContents: { mainFrame: unknown }
}

/** The call must come from the main window's own top frame: not another window, not a sub-frame, not a detached frame. */
export function isTrustedSender(event: { sender: unknown; senderFrame?: unknown }, win: TrustedWindow | null | undefined): boolean {
  if (!win || event.sender !== win.webContents) return false
  return event.senderFrame != null && event.senderFrame === win.webContents.mainFrame
}

/** Links written by a model may open in the browser over https only. */
export function isExternalHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
