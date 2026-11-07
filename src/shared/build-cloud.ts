// The Atelier Cloud a packaged app signs in to by default, decided at build time (electron.vite.config.ts `define`):
// ATELIER_CLOUD_URL, else ATELIER_BETA_CLOUD (what `npm run dist` / `dist:mac` are given for the beta), else '' — and an
// empty value means the local development Cloud (loopback), the fallback of dev and tests. No address lives in the source.
// The person's own choice (the `cloud.baseUrl` setting, Réglages) always wins over this default.
export function buildCloudUrl(env: Record<string, string | undefined>): string {
  return (env.ATELIER_CLOUD_URL || env.ATELIER_BETA_CLOUD || '').trim()
}
