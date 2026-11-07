// Lets plain Node run main-process TypeScript (`node --import ./scripts/ts-transpile.mjs file.ts`), without any
// experimental flag: src/main uses syntax that Node's type stripping refuses (parameter properties), so this hook
// compiles each of the repository's .ts files with the TypeScript compiler (transpile only, no type check) and resolves
// extension-less relative imports like the bundler does (`./types` → `./types.ts` or `./types/index.ts`).
// Used by `npm run orchestra:demo`. src/engine stays erasable-syntax-only and keeps using ts-resolve.mjs.
import { register } from 'node:module'

register('./ts-transpile-hooks.mjs', import.meta.url)
