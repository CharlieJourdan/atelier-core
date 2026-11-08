import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import path from 'node:path'

/** Packages src/engine may not load: `electron` (and its subpaths) and `@electron/*`. */
export const ENGINE_FORBIDDEN_PACKAGE = /^(?:electron(?:\/.*)?|@electron\/.*)$/

/** App folders src/engine may not load: the main process, the renderer (also through its `@` alias) and the preload. */
const ENGINE_FORBIDDEN_DIRS = ['main', 'renderer', 'preload']

/**
 * `atelier/engine-boundary`: src/engine may not load Electron nor anything under src/main, src/renderer (also through
 * the renderer's `@` alias) or src/preload. Every way a module can be named is checked (import, export-from, import(),
 * require(), createRequire(...)(), module.require(), import x = require()), with a string or a template literal without
 * expressions. Relative paths are resolved against the file's folder (so `./../main` or `../shared/../main` are
 * caught); a path naming `src/main` (or the other folders) is refused as well. `require`, `.require` and
 * `createRequire(...)` (also `ns.createRequire(...)`) must be called on the spot: passing them around
 * (`const r = require`, `const { require: r } = module`, `import { createRequire as cr }`) is refused, since the rule
 * could not follow the alias.
 * Limit: this is a static check of plain code. Reaching a loader through computed globals (`globalThis['req' + 'uire']`),
 * `eval`, `new Function` or `process.mainModule` is not traced; code review covers those.
 */
const engineBoundary = {
  meta: {
    type: 'problem',
    messages: {
      forbidden:
        "src/engine must not load '{{source}}' (Electron, src/main, src/renderer, src/preload): it runs outside the app too, inject what it needs.",
      dynamic: 'src/engine must load modules by a fixed name (no computed import() / require()), so the boundary can be checked.',
      aliased: 'src/engine must call require / createRequire(...) on the spot (no alias), so the boundary can be checked.'
    }
  },
  create(context) {
    const appDirs = ENGINE_FORBIDDEN_DIRS.map((d) => path.resolve(context.cwd, 'src', d))
    const namedDir = new RegExp(`(?:^|/)src/(?:${ENGINE_FORBIDDEN_DIRS.join('|')})(?:/|$)`)
    const fileDir = path.dirname(context.filename)
    const forbidden = (spec) => {
      const norm = spec.split('\\').join('/')
      if (ENGINE_FORBIDDEN_PACKAGE.test(norm)) return true
      if (norm === '@' || norm.startsWith('@/')) return true // the renderer's alias
      if (namedDir.test(path.posix.normalize(norm))) return true
      if (norm.startsWith('.')) {
        const target = path.resolve(fileDir, norm)
        return appDirs.some((dir) => target === dir || target.startsWith(dir + path.sep))
      }
      return false
    }
    const literal = (node) => {
      if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
      if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? null
      return undefined
    }
    const check = (node, dynamic = false) => {
      if (!node) return
      const spec = literal(node)
      if (spec === undefined) {
        if (dynamic) context.report({ node, messageId: 'dynamic' })
        return
      }
      if (spec !== null && forbidden(spec)) context.report({ node, messageId: 'forbidden', data: { source: spec } })
    }
    // `createRequire` or `<namespace>.createRequire`
    const isCreateRequire = (callee) =>
      (callee.type === 'Identifier' && callee.name === 'createRequire') ||
      (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'createRequire')
    const isRequireLike = (callee) =>
      (callee.type === 'Identifier' && callee.name === 'require') ||
      (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'require') ||
      (callee.type === 'CallExpression' && isCreateRequire(callee.callee))
    const calledHere = (node) => node.parent?.type === 'CallExpression' && node.parent.callee === node
    return {
      ImportDeclaration: (n) => check(n.source),
      ExportNamedDeclaration: (n) => check(n.source),
      ExportAllDeclaration: (n) => check(n.source),
      ImportExpression: (n) => check(n.source, true),
      TSImportEqualsDeclaration: (n) => check(n.moduleReference?.expression),
      CallExpression: (n) => {
        if (isRequireLike(n.callee)) check(n.arguments[0], true)
        if (isCreateRequire(n.callee) && !calledHere(n)) context.report({ node: n, messageId: 'aliased' })
      },
      // `import { createRequire as cr }`: a renamed loader could not be followed
      ImportSpecifier: (n) => {
        const imported = n.imported.type === 'Identifier' ? n.imported.name : n.imported.value
        if (imported === 'createRequire' && n.local.name !== 'createRequire') context.report({ node: n, messageId: 'aliased' })
      },
      Identifier: (n) => {
        if (n.name !== 'require' || calledHere(n)) return
        const p = n.parent
        // `const { require: r } = module`: the key names the loader, the binding hides it
        if (p?.type === 'Property' && p.parent?.type === 'ObjectPattern') {
          if (p.key === n) context.report({ node: n, messageId: 'aliased' })
          return
        }
        if (p?.type === 'MemberExpression' && p.property === n && !p.computed) return // `.require`: checked below
        const isKey = ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(p?.type) && p.key === n && !p.computed
        if (!isKey) context.report({ node: n, messageId: 'aliased' })
      },
      MemberExpression: (n) => {
        if (!n.computed && n.property.type === 'Identifier' && n.property.name === 'require' && !calledHere(n)) {
          context.report({ node: n, messageId: 'aliased' })
        }
      }
    }
  }
}

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'dist-web/**', 'dist-demo/**', 'release/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'cloud/**/*.ts', 'tests/**/*.{ts,mjs}', 'scripts/**/*.{ts,mjs}', '*.config.ts', '*.config.mts', '*.config.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    // Demo code (PLAN-V2 §8.4) shows what a feature would look like: it must never reach the API. Two layers:
    //  1. imports are an ALLOWLIST (a denylist of `state/client` misses every wrapper hook / module that calls it);
    //  2. every way of getting at `window.atelier` (dot, computed, template, destructuring, bare global) is banned.
    files: ['src/renderer/demo/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Anything that is NOT: react, lucide, the ui / atelier component kits, pure lib helpers, the vendored kit,
              // files inside demo/ itself, or the shared pure data under src/shared. A `..` segment inside an allowed
              // prefix (e.g. '@/components/ui/../../state/client') voids the allowance.
              regex:
                String.raw`^(?!(?:react|react/jsx-runtime|lucide-react)$|(?:@/components/(?:ui|atelier)/|@/vendor/|\./)(?!.*\.\.)|@/lib/(?:utils|toast|features)$|(?:\.\./){2,}shared/(?!.*\.\.))`,
              message:
                'Demo code may only import react, lucide-react, @/components/{ui,atelier}, @/lib/{utils,toast,features}, @/vendor, ./ files and src/shared (it must not reach the Atelier API).'
            }
          ]
        }
      ],
      'no-restricted-globals': ['error', { name: 'atelier', message: 'Demo code must not call the Atelier API.' }],
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[property.name='atelier']", message: 'Demo code must not call the Atelier API.' },
        { selector: "MemberExpression[computed=true][property.value='atelier']", message: 'Demo code must not call the Atelier API.' },
        {
          selector: "MemberExpression[computed=true][property.type='TemplateLiteral']",
          message: 'Demo code must not use computed access on objects (window[`atelier`]).'
        },
        {
          selector: "MemberExpression[computed=true][object.name=/^(window|globalThis|self)$/]",
          message: 'Demo code must not use computed access on the global object.'
        },
        { selector: "ObjectPattern > Property[key.name='atelier']", message: 'Demo code must not destructure `atelier`.' },
        { selector: "ObjectPattern > Property[key.value='atelier']", message: 'Demo code must not destructure `atelier`.' },
        { selector: "Literal[value='atelier']", message: 'Demo code must not name the Atelier API bridge.' },
        { selector: "TemplateElement[value.cooked='atelier']", message: 'Demo code must not name the Atelier API bridge.' },
        { selector: 'ImportExpression', message: 'Demo code may not use dynamic import().' },
        { selector: "CallExpression[callee.name='require']", message: 'Demo code may not use require().' }
      ]
    }
  },
  {
    // The production engine (PLAN-V2-PRODUCTION §1.12, docs/ENGINE-SPEC.md R13.1) runs unchanged in the app, the local
    // worker, Atelier Cloud and the RunPod images: it may not import Electron nor anything of the app's main process
    // (src/main/**), whether by a static import, an export-from, a dynamic import() or require().
    files: ['src/engine/**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
    plugins: { atelier: { rules: { 'engine-boundary': engineBoundary } } },
    rules: { 'atelier/engine-boundary': 'error' }
  },
  {
    // The headless brain (docs/BRAIN-HEADLESS.md) and the link to it run without Electron: no `electron` import and none
    // of the Electron adapters (src/main/electron). The whole import graph is checked at run time by
    // tests/unit/headless-boot.test.ts; this catches the direct case at lint time.
    files: ['src/main/headless/**/*.ts', 'src/main/brain/**/*.ts', 'src/shared/brain-client.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: String.raw`^(?:electron(?:/.*)?|@electron/.*)$`, message: 'The headless brain runs in plain Node: inject what needs Electron.' },
            { regex: String.raw`(?:^|/)electron/`, message: 'The headless brain may not use the Electron adapters (src/main/electron).' }
          ]
        }
      ]
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  }
)
