// Content-Security-Policy of the renderer page. The dev server needs inline styles (Vite injects <style> tags) and
// a websocket (HMR); the packaged app needs neither. React `style={{}}` props are set through the CSSOM and are not
// blocked by `style-src 'self'`. The app embeds no third-party page (no <webview>).

const BASE = [
  "default-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
]

export const CSP_DEV = [...BASE, "style-src 'self' 'unsafe-inline'", "connect-src 'self' ws://localhost:*"].join('; ')

/**
 * Radix dialogs (the ⌘K palette, the confirmation modal) lock the page scroll through react-remove-scroll-bar, which
 * injects one <style> element with fixed content (no scrollbar gap here: html/body never scroll). A strict CSP blocks
 * it, so its exact content is allowed by hash instead of opening 'unsafe-inline'. The e2e shell spec fails on any
 * CSP violation, so a Radix upgrade that changes the content shows up there.
 */
export const RADIX_SCROLL_LOCK_STYLE_HASH = "'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='"

export const CSP_PROD = [...BASE, `style-src 'self' ${RADIX_SCROLL_LOCK_STYLE_HASH}`, "connect-src 'self'"].join('; ')
