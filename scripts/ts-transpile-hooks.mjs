// Module hooks behind scripts/ts-transpile.mjs (they run on Node's loader thread).
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(path.join(ROOT, 'package.json'))('typescript')

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (e) {
    if (!specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) throw e
    for (const tail of ['.ts', '/index.ts']) {
      try {
        return await next(specifier + tail, context)
      } catch {
        // try the next form
      }
    }
    throw e
  }
}

export async function load(url, context, next) {
  if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, context)
  const file = fileURLToPath(url)
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}node_modules${path.sep}`)) return next(url, context)
  const source = await readFile(file, 'utf8')
  const out = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
      isolatedModules: true,
      sourceMap: false,
      inlineSourceMap: true,
      inlineSources: false
    }
  })
  return { format: 'module', source: out.outputText, shortCircuit: true, url: pathToFileURL(file).href }
}
