// Lets plain Node run the engine's TypeScript (`node --import ./scripts/ts-resolve.mjs
// file.ts`): the engine imports its own modules without an extension (`./types`), as the bundler expects; this hook
// tries `.ts` and `/index.ts` for relative imports that do not resolve as written. Used by `npm run engine:demo`.
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (e) {
    if (!specifier.startsWith('.') || /\\.[cm]?[jt]s$/.test(specifier)) throw e
    for (const tail of ['.ts', '/index.ts']) {
      try {
        return await next(specifier + tail, context)
      } catch {}
    }
    throw e
  }
}`)
)
