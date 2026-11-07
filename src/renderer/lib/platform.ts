// Platform detection for layout only (the macOS traffic lights sit inside the rail; Windows draws its controls on
// the right of the top strip). Takes the user agent so tests can simulate darwin.
export function isMacUserAgent(ua: string): boolean {
  return /Macintosh|Mac OS X/.test(ua)
}

export const IS_MAC = typeof navigator !== 'undefined' && isMacUserAgent(navigator.userAgent)
