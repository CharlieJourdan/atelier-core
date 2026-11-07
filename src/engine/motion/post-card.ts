// The « post » intro card of a story short (clone-reddit-shorts, research note style-redditchroniques-2026-11 (old repository)): a forum
// post as the hook — the channel's round avatar, its name and a verified mark, a row of small award icons, the title in heavy
// type, then the reactions line (likes, comments, share). Drawn by the browser from this page (one transparent frame), with
// our bundled Inter and our own icons (simple flat drawings, no picture of any site). Measured at 1080 px wide: the card is
// 890 × ~350 px, 96 px from each side.

export interface PostCardInput {
  title: string
  channel: string
  /** The channel's avatar as a data URL (a square picture); absent: a coloured circle with the initial. */
  avatar?: string
  accent: string
  /** The reactions shown under the title (« 69+ », « 420+ »). */
  likes: string
  comments: string
  share: string
  verified: boolean
  /** Award icons in the row under the name (0–8). */
  awards: number
  /** @font-face rules of the bundled Inter. */
  fontCss: string
}

/** Card measurements at 1080 px wide (the reference's). */
export const POST_CARD = { width: 890, frameWidth: 1080, top: 286, pad: 34, avatar: 148 } as const

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Our award icons, 64 × 64 view boxes: flat shapes with a dark outline, in the spirit of a forum's award row. */
const AWARDS: readonly string[] = [
  // a smiling cloud with sparkles
  '<path d="M14 40a10 10 0 0 1 4-19 14 14 0 0 1 27-2 11 11 0 0 1 5 21z" fill="#fff" stroke="#222" stroke-width="3"/><circle cx="26" cy="31" r="2.5" fill="#222"/><circle cx="38" cy="31" r="2.5" fill="#222"/><path d="M27 36q5 4 10 0" stroke="#222" stroke-width="2.5" fill="none"/><path d="M52 8l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM10 46l1.5 3.5 3.5 1.5-3.5 1.5L10 56l-1.5-3.5L5 51l3.5-1.5z" fill="#FFC83D"/>',
  // a small red heart
  '<path d="M32 52S12 39 12 26a10 10 0 0 1 20-3 10 10 0 0 1 20 3c0 13-20 26-20 26z" fill="#FF4D4D" stroke="#9E1B1B" stroke-width="2.5"/>',
  // a faceted ruby heart
  '<path d="M32 56S8 40 8 24a12 12 0 0 1 24-4 12 12 0 0 1 24 4c0 16-24 32-24 32z" fill="#E0314B" stroke="#7A0F22" stroke-width="2.5"/><path d="M20 18l6 12-10 6M44 18l-6 12 10 6M26 30h12l-6 18z" stroke="#FF8FA0" stroke-width="2" fill="none"/>',
  // a little locomotive
  '<rect x="10" y="26" width="34" height="18" rx="3" fill="#F2D27A" stroke="#222" stroke-width="2.5"/><rect x="38" y="16" width="14" height="28" rx="2" fill="#C9A24A" stroke="#222" stroke-width="2.5"/><rect x="14" y="18" width="6" height="8" fill="#555" stroke="#222" stroke-width="2"/><circle cx="18" cy="48" r="5" fill="#444" stroke="#222" stroke-width="2"/><circle cx="34" cy="48" r="5" fill="#444" stroke="#222" stroke-width="2"/><circle cx="48" cy="48" r="5" fill="#444" stroke="#222" stroke-width="2"/>',
  // a green gem in a gold mount
  '<circle cx="32" cy="32" r="22" fill="#D9A520" stroke="#6B4E0A" stroke-width="2.5"/><path d="M32 16l12 8v16l-12 8-12-8V24z" fill="#2FCF9A" stroke="#0E6B4A" stroke-width="2.5"/><path d="M32 16v32M20 24l24 16M44 24L20 40" stroke="#9BF5D6" stroke-width="1.5"/>',
  // a gold trophy
  '<path d="M20 12h24v12a12 12 0 0 1-24 0z" fill="#FFC83D" stroke="#7A5A00" stroke-width="2.5"/><path d="M20 16h-7a7 7 0 0 0 7 10M44 16h7a7 7 0 0 1-7 10" fill="none" stroke="#7A5A00" stroke-width="2.5"/><rect x="28" y="36" width="8" height="8" fill="#E8B020" stroke="#7A5A00" stroke-width="2"/><rect x="20" y="44" width="24" height="8" rx="2" fill="#FFC83D" stroke="#7A5A00" stroke-width="2.5"/>',
  // a megaphone
  '<path d="M12 26h10l22-12v36L22 38H12z" fill="#F4F4F4" stroke="#222" stroke-width="2.5"/><path d="M16 38l4 12h6l-3-12" fill="#ddd" stroke="#222" stroke-width="2.5"/><path d="M50 24q6 8 0 16" stroke="#FF8A1F" stroke-width="3" fill="none"/>',
  // a friendly ghost
  '<path d="M16 52V28a16 16 0 0 1 32 0v24l-5-5-5 5-6-5-6 5-5-5z" fill="#fff" stroke="#222" stroke-width="2.5"/><circle cx="26" cy="28" r="3" fill="#FF5A36"/><circle cx="38" cy="28" r="3" fill="#FF5A36"/>'
]

const HEART = '<path d="M12 21s-8-5.2-8-11.2A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 2.8C20 15.8 12 21 12 21z" fill="none" stroke="#333" stroke-width="1.8" stroke-linejoin="round"/>'
const BUBBLE = '<path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.7L3.5 20.5l4.4-1.1A8.5 8.5 0 1 0 12 3.5z" fill="none" stroke="#333" stroke-width="1.8" stroke-linejoin="round"/>'
const SHARE = '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5v6.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6.5" fill="none" stroke="#333" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
const VERIFIED =
  '<circle cx="12" cy="12" r="11" fill="#1D9BF0"/><path d="M7 12.4l3.3 3.2L17.2 8.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'

/** The page: the card alone on a transparent page sized to it (the browser crops nothing; `render.assemble` places it). */
export function postCardHtml(o: PostCardInput): string {
  const { width, pad, avatar } = POST_CARD
  const initial = esc((Array.from(o.channel.trim())[0] ?? 'A').toUpperCase())
  const face = o.avatar
    ? `<img class="av" src="${o.avatar}" alt="">`
    : `<div class="av" style="background:${o.accent}"><span>${initial}</span></div>`
  const awards = AWARDS.slice(0, Math.max(0, Math.min(8, o.awards)))
    .map((d) => `<svg viewBox="0 0 64 64" class="aw">${d}</svg>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${o.fontCss}
html,body{margin:0;background:transparent}
.card{box-sizing:border-box;width:${width}px;margin:0 auto 46px auto;padding:18px ${pad}px 26px ${pad}px;background:#fff;border-radius:30px;
  box-shadow:0 4px 10px rgba(0,0,0,.45),0 14px 32px rgba(0,0,0,.55);font-family:'Inter',sans-serif;color:#111}
.head{display:flex;align-items:center;gap:16px}
.av{width:${avatar}px;height:${avatar}px;border-radius:50%;object-fit:cover;flex:none;display:flex;align-items:center;justify-content:center}
.av span{color:#fff;font-weight:700;font-size:64px}
.name{font-weight:700;font-size:39px;letter-spacing:-.4px;display:flex;align-items:center;gap:10px}
.name svg{width:38px;height:38px}
.awards{display:flex;gap:6px;margin-top:8px}
.aw{width:58px;height:58px}
.title{font-weight:700;font-size:51px;line-height:51px;letter-spacing:-1.5px;margin:10px 0 0 0}
.foot{display:flex;align-items:center;margin-top:18px;font-size:30px;color:#333;font-weight:600}
.foot svg{width:36px;height:36px;margin-right:6px}
.foot .c{margin-left:22px}
.foot .s{margin-left:auto}
</style></head><body><div class="card" id="card">
<div class="head">${face}<div><div class="name">${esc(o.channel)}${o.verified ? `<svg viewBox="0 0 24 24">${VERIFIED}</svg>` : ''}</div><div class="awards">${awards}</div></div></div>
<div class="title">${esc(o.title)}</div>
<div class="foot"><svg viewBox="0 0 24 24">${HEART}</svg>${esc(o.likes)}<span class="c" style="display:flex;align-items:center"><svg viewBox="0 0 24 24">${BUBBLE}</svg>${esc(o.comments)}</span><span class="s" style="display:flex;align-items:center"><svg viewBox="0 0 24 24">${SHARE}</svg>${esc(o.share)}</span></div>
</div></body></html>`
}
