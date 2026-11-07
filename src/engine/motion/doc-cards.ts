// The documentary cards (formats/cards.ts): archive (doc-archive.ts: full, board, paper, tv), bars and timeline (doc-data.ts), prints (doc-prints.ts). Each draws its
// own opaque background and fills the frame; `motionHtml` (index.ts) calls them.
export { archiveCard } from './doc-archive'
export { barsCard, timelineCard } from './doc-data'
export { printsCard } from './doc-prints'
