// The pictures of the demo's « Créer une pipeline »: frames watched, side-by-side pairs and proposal previews, drawn as small
// SVG documents (no remote file, the strict CSP lets a data: picture through). Everything is invented: a fictional
// astronomy-history channel (night skies, archive plates, star charts, orbits), no real image, no real person.

export type Scene = 'sky' | 'archive' | 'map' | 'orbit' | 'telescope' | 'plate'
export const SCENES: readonly Scene[] = ['archive', 'sky', 'map', 'orbit', 'telescope', 'plate']

/** Reference or ours: ours is a touch warmer and softer, as a real reproduction would be. */
export type Tint = 'ref' | 'ours'

const W = 640
const H = 360

/** A tiny deterministic generator, so a frame looks the same on every poll. */
function rng(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280 || 1
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function stars(r: () => number, n: number, maxY = H): string {
  let out = ''
  for (let i = 0; i < n; i++) {
    const x = (r() * W).toFixed(1)
    const y = (r() * maxY).toFixed(1)
    const rad = (0.4 + r() * 1.4).toFixed(2)
    out += `<circle cx="${x}" cy="${y}" r="${rad}" fill="#fff" opacity="${(0.35 + r() * 0.65).toFixed(2)}"/>`
  }
  return out
}

function caption(text: string, tint: Tint): string {
  if (!text) return ''
  const bar = tint === 'ours' ? '#1d1a16' : '#111317'
  return `<rect x="28" y="288" width="${Math.min(584, 24 + text.length * 9.4)}" height="40" rx="3" fill="${bar}" opacity="0.82"/>` +
    `<rect x="28" y="288" width="4" height="40" fill="#e3b04b"/>` +
    `<text x="44" y="314" font-family="Georgia, serif" font-size="17" fill="#f3ead8">${esc(text)}</text>`
}

function sky(seed: number, tint: Tint): string {
  const r = rng(seed)
  const [a, b] = tint === 'ours' ? ['#1b2440', '#06070f'] : ['#132046', '#04050c']
  return `<defs><radialGradient id="g${seed}" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g${seed})"/>` +
    `<ellipse cx="320" cy="170" rx="380" ry="46" transform="rotate(-18 320 170)" fill="#9fb4ff" opacity="0.10"/>` +
    stars(r, 140) +
    `<circle cx="${480 + r() * 80}" cy="${70 + r() * 40}" r="26" fill="#f1ecd9"/><circle cx="${470 + r() * 80}" cy="${64 + r() * 40}" r="24" fill="${b}" opacity="0.55"/>` +
    `<path d="M0 330 Q160 300 320 322 T640 312 V360 H0 Z" fill="#020306"/>`
}

function archive(seed: number, tint: Tint): string {
  const r = rng(seed)
  const paper = tint === 'ours' ? '#d8c39c' : '#d3bd92'
  const ink = '#3d2f1f'
  const dx = r() * 60
  return `<rect width="${W}" height="${H}" fill="#2a2119"/>` +
    `<rect x="70" y="26" width="500" height="300" fill="${paper}"/>` +
    `<rect x="90" y="44" width="460" height="230" fill="#8a7357"/>` +
    `<path d="M${180 + dx} 274 V190 A90 90 0 0 1 ${360 + dx} 190 V274 Z" fill="${ink}"/>` +
    `<rect x="${262 + dx}" y="108" width="16" height="70" transform="rotate(-24 ${270 + dx} 140)" fill="${paper}" opacity="0.8"/>` +
    `<rect x="90" y="250" width="460" height="24" fill="${ink}" opacity="0.5"/>` +
    stars(r, 18, 140).replace(/#fff/g, paper) +
    `<text x="96" y="304" font-family="Georgia, serif" font-size="13" fill="${ink}">Plaque n° ${100 + Math.floor(r() * 800)} · observatoire, vers 1890</text>` +
    `<rect width="${W}" height="${H}" fill="none" stroke="#000" stroke-width="60" opacity="0.35"/>`
}

function map(seed: number, tint: Tint): string {
  const r = rng(seed)
  const bg = tint === 'ours' ? '#14213a' : '#101c34'
  let grid = ''
  for (let i = 1; i <= 4; i++) grid += `<circle cx="320" cy="180" r="${i * 48}" fill="none" stroke="#c9b37a" stroke-width="0.8" opacity="0.35"/>`
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6
    grid += `<line x1="320" y1="180" x2="${(320 + Math.cos(a) * 200).toFixed(1)}" y2="${(180 + Math.sin(a) * 200).toFixed(1)}" stroke="#c9b37a" stroke-width="0.6" opacity="0.3"/>`
  }
  const pts = Array.from({ length: 7 }, () => [140 + r() * 360, 60 + r() * 220] as const)
  const lines = pts.slice(1).map((p, i) => `<line x1="${pts[i]![0].toFixed(1)}" y1="${pts[i]![1].toFixed(1)}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" stroke="#f1d58a" stroke-width="1.6"/>`).join('')
  const dots = pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="#fff6d8"/>`).join('')
  return `<rect width="${W}" height="${H}" fill="${bg}"/>` + stars(r, 60) + grid + lines + dots
}

function orbit(seed: number, tint: Tint): string {
  const r = rng(seed)
  const sun = tint === 'ours' ? '#ffc86b' : '#ffbe55'
  let rings = ''
  let planets = ''
  for (let i = 1; i <= 4; i++) {
    const rx = 70 + i * 52
    const ry = rx * 0.34
    rings += `<ellipse cx="320" cy="190" rx="${rx}" ry="${ry.toFixed(1)}" fill="none" stroke="#7d8fbf" stroke-width="1" opacity="0.6"/>`
    const a = r() * Math.PI * 2
    planets += `<circle cx="${(320 + Math.cos(a) * rx).toFixed(1)}" cy="${(190 + Math.sin(a) * ry).toFixed(1)}" r="${5 + i * 2}" fill="${['#9ec5ff', '#e7a46b', '#c8d9a1', '#d6c2ff'][i - 1]}"/>`
  }
  return `<rect width="${W}" height="${H}" fill="#05060b"/>` + stars(r, 90) + rings +
    `<circle cx="320" cy="190" r="34" fill="${sun}"/><circle cx="320" cy="190" r="52" fill="${sun}" opacity="0.15"/>` + planets
}

function telescope(seed: number, tint: Tint): string {
  const r = rng(seed)
  const [top, low] = tint === 'ours' ? ['#2b2f5c', '#d98b5f'] : ['#252a58', '#d27f55']
  return `<defs><linearGradient id="d${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.75" stop-color="${low}"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#d${seed})"/>` + stars(r, 50, 150) +
    `<path d="M0 292 Q200 250 380 280 T640 266 V360 H0 Z" fill="#14121c"/>` +
    `<rect x="300" y="180" width="140" height="18" rx="4" transform="rotate(-32 330 220)" fill="#14121c"/>` +
    `<line x1="330" y1="222" x2="300" y2="290" stroke="#14121c" stroke-width="5"/><line x1="330" y1="222" x2="362" y2="290" stroke="#14121c" stroke-width="5"/><line x1="330" y1="222" x2="332" y2="294" stroke="#14121c" stroke-width="5"/>`
}

function plate(seed: number, tint: Tint): string {
  const r = rng(seed)
  const glass = tint === 'ours' ? '#20242b' : '#1c2026'
  let dots = ''
  for (let i = 0; i < 160; i++) dots += `<circle cx="${(110 + r() * 420).toFixed(1)}" cy="${(40 + r() * 280).toFixed(1)}" r="${(0.5 + r() * 1.8).toFixed(2)}" fill="#0b0c0e"/>`
  return `<rect width="${W}" height="${H}" fill="#3a3f47"/>` +
    `<rect x="100" y="30" width="440" height="300" fill="#cfd3d6"/>` + dots +
    `<circle cx="${200 + r() * 240}" cy="${100 + r() * 140}" r="16" fill="none" stroke="#b3261e" stroke-width="2.5"/>` +
    `<rect x="100" y="30" width="440" height="300" fill="${glass}" opacity="0.08"/>` +
    `<text x="112" y="322" font-family="monospace" font-size="11" fill="#2b2f36">PLAQUE 4127 · 12 FÉVR.</text>`
}

const DRAW: Record<Scene, (seed: number, tint: Tint) => string> = { sky, archive, map, orbit, telescope, plate }

/** The inside of one 640×360 frame: a scene and, maybe, a documentary lower-third. */
export function frameBody(scene: Scene, seed: number, tint: Tint = 'ref', text = ''): string {
  return DRAW[scene](seed, tint) + caption(text, tint)
}

const doc = (w: number, h: number, body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

/** One frame as a full SVG document. */
export function frameSvg(scene: Scene, seed: number, tint: Tint = 'ref', text = ''): string {
  return doc(W, H, frameBody(scene, seed, tint, text))
}

/** The reference and ours at the same moment, side by side (32:9). */
export function pairSvg(scene: Scene, seed: number, text = ''): string {
  return doc(W * 2, H, `<svg x="0" y="0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${frameBody(scene, seed, 'ref', text)}</svg>` +
    `<svg x="${W}" y="0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${frameBody(scene, seed, 'ours', text)}</svg>` +
    `<rect x="${W - 2}" y="0" width="4" height="${H}" fill="#000"/>`)
}

/** A proposal's preview: as in the example, with his own voice (a waveform), or the vertical short. */
export function previewSvg(kind: 'as-example' | 'own-voice' | 'short'): string {
  if (kind === 'as-example') return frameSvg('archive', 41, 'ours', 'La nuit où le ciel a été photographié')
  if (kind === 'own-voice') {
    let bars = ''
    for (let i = 0; i < 40; i++) {
      const h = 8 + Math.abs(Math.sin(i * 0.7) * 38) + (i % 3) * 4
      bars += `<rect x="${140 + i * 9}" y="${(250 - h / 2).toFixed(1)}" width="5" height="${h.toFixed(1)}" rx="2" fill="#f3ead8" opacity="0.9"/>`
    }
    return doc(W, H, frameBody('telescope', 17, 'ours') + `<rect x="120" y="206" width="400" height="88" rx="12" fill="#000" opacity="0.45"/>` + bars)
  }
  return doc(W, H, `<rect width="${W}" height="${H}" fill="#0c0d12"/>` +
    `<svg x="219" y="0" width="202" height="${H}" viewBox="219 0 202 ${H}" preserveAspectRatio="xMidYMid slice">${frameBody('sky', 23, 'ours')}</svg>` +
    `<rect x="219" y="0" width="202" height="${H}" fill="none" stroke="#e3b04b" stroke-width="2"/>` +
    `<text x="320" y="300" text-anchor="middle" font-family="Georgia, serif" font-size="15" font-weight="bold" fill="#fff">1 PHOTO,</text>` +
    `<text x="320" y="320" text-anchor="middle" font-family="Georgia, serif" font-size="15" font-weight="bold" fill="#e3b04b">1 MYSTÈRE</text>`)
}
