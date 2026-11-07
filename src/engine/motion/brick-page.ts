// The page of a custom brick (docs/ENGINE-SPEC.md §25.2): the brick's markup, style and script inside OUR document, which carries a strict
// Content-Security-Policy (nothing from anywhere but `data:` pictures and fonts, only the scripts that hold this page's random nonce: no
// injected script, no inline handler, no eval), the runtime clock of our templates (runtime.ts: `window.atelierRenderAt(t)`, the `data-anim`
// presets, text fitting) and a small `brick` object the brick's script uses (its values, the frame, the safe area, easings, a seeded
// random). The brick's script runs in its own function in strict mode; it sets `brick.render = function (t) {…}` to draw frame t. The page
// sets `window.atelierReady` when everything started, or `window.atelierError` when the brick's script threw. The browser service opens it
// in a sandboxed page (no network, a time budget per frame). Values are escaped where they land: text in the markup, colours as CSS
// variables `--f-<field>`, everything in `brick.values`.
import { randomBytes } from 'node:crypto'
import type { Brick, BrickValues } from '../formats/brick'
import { esc, themeOf, zone, type MotionCtx } from './base'
import { RUNTIME_JS } from './runtime'

export const brickCsp = (nonce: string): string =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')

/** JSON safe inside a <script> element. */
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)
const BS = String.fromCharCode(92)
const scriptJson = (v: unknown): string => JSON.stringify(v).split('<').join(BS + 'u003c').split(LS).join(BS + 'u2028').split(PS).join(BS + 'u2029')

const BRICK_JS = String.raw`
(function () {
  var m = window.__atelierMotion, cfg = window.__brickConfig;
  var h = 2166136261;
  for (var i = 0; i < cfg.seed.length; i++) h = Math.imul(h ^ cfg.seed.charCodeAt(i), 16777619);
  var a = h >>> 0;
  window.brick = {
    values: cfg.values, width: cfg.width, height: cfg.height, duration: cfg.duration, safe: cfg.safe, accent: cfg.accent, theme: cfg.theme,
    ease: m.ease, clamp: m.clamp, format: m.formatNumber,
    /** progress of t between start and start + dur, 0..1 */
    at: function (t, start, dur) { return m.clamp((t - start) / (dur || 1), 0, 1); },
    /** seeded: the same brick draws the same frame every time */
    random: function () { a = (a + 0x6d2b79f5) | 0; var x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; },
    render: null
  };
})();
`
const WRAP_JS = String.raw`
(function () {
  var base = window.atelierRenderAt;
  window.atelierRenderAt = function (t) { base(t); if (typeof window.brick.render === 'function') window.brick.render(t); };
  if (typeof window.atelierError !== 'string') window.atelierReady = true;
})();
`

/** The brick's markup with `{{field}}` replaced by its value, escaped (a number is written as it is). */
export function fillMarkup(html: string, values: BrickValues): string {
  return html.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = values[k]
    return v === undefined ? '' : esc(String(v))
  })
}

export function brickPage(b: Brick, values: BrickValues, c: MotionCtx, look: { accent: string; theme: 'dark' | 'light' }, nonce = randomBytes(18).toString('base64')): string {
  const t = themeOf(look.accent, look.theme)
  const z = zone(c)
  const colours = b.fields
    .filter((f) => f.type === 'color' && typeof values[f.name] === 'string')
    .map((f) => `--f-${f.name}:${String(values[f.name])};`)
    .join('')
  const cfg = { values, width: c.width, height: c.height, duration: c.durationS, safe: { left: z.left, top: z.top, right: z.right, bottom: z.bottom }, accent: look.accent, theme: look.theme, seed: `${b.id}@${b.version}` }
  const user = `try { (function (brick) { 'use strict';\n${b.script}\n})(window.brick); } catch (e) { window.atelierError = String((e && e.message) || e); }`
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${brickCsp(nonce)}">
<title>brick</title><style>
${c.fontCss}
:root{--accent:${look.accent};--fg:${t.fg};--muted:${t.muted};--panel:${t.panel};--line:${t.line};--chip:${t.chip};--chip-text:${t.chipText};--scrim:${t.scrim};${colours}--safe-left:${z.left}px;--safe-top:${z.top}px;--safe-right:${z.right}px;--safe-bottom:${z.bottom}px}
html,body{margin:0;padding:0;width:${c.width}px;height:${c.height}px;overflow:hidden;background:transparent}
*{box-sizing:border-box}
body{position:relative;font-family:'Inter','Segoe UI','Helvetica Neue',Arial,sans-serif;font-weight:600;color:var(--fg);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
[data-anim]{opacity:0}
</style><style>
${b.css}
</style></head><body>
${fillMarkup(b.html, values)}
<script nonce="${nonce}">${RUNTIME_JS}</script>
<script nonce="${nonce}">window.__brickConfig = ${scriptJson(cfg)};${BRICK_JS}</script>
<script nonce="${nonce}">${user}</script>
<script nonce="${nonce}">${WRAP_JS}</script>
</body></html>`
}
