// Media sourcing bricks: one interface (query → ranked candidates with legal status, preview URL, cost) over free archives,
// stock libraries, public excerpts, sound effects and music. Spec and benchmark: research note technos-medias-2026-11 (old repository).
export { searchMedia, type MediaSearchDeps, type MediaSearchOptions } from './search.ts'
export { KEYLESS, KEYED, WEB, PAID, PROVIDERS, FREE_KEYS, withLocalBank } from './catalog.ts'
export { MemoryCache, FileCache, cacheKey, type SearchCache } from './cache.ts'
export { heuristicRank, heuristicScore, claudeReranker, claudeExpander, applyRerank, dedupeCandidates, wordMatch, type AskClaude, type QueryExpander, type Reranker } from './rank.ts'
export { creditLine, creditsText, publishBlockers, FAIR_USE_LICENCE } from './legal.ts'
export { downloadExcerpt, probeVideo, clampRange, spawnRun, youtubeExcerpts, MAX_EXCERPT_S, DEFAULT_EXCERPT_S } from './providers/ytdlp.ts'
export { localBank } from './providers/local-bank.ts'
export {
  MEDIA_KINDS,
  type LegalStatus,
  type MediaCandidate,
  type MediaKind,
  type MediaLicence,
  type MediaSearchResult,
  type ProviderCtx,
  type ReviewStatus,
  type SourceQuery,
  type SourcingProvider
} from './types.ts'
export { planNeeds, parseNeeds, fallbackNeed, type Beat, type Need, type NeedMode } from './needs.ts'
export { pickMedia, parsePicks, pickPrompt, type Pick, type PickItem, type PickMatch } from './pick.ts'
export { verifyClips, parseVerdicts, type Verdict, type ClipToCheck, type Problem } from './verify.ts'
export { geminiWatch, parseShotLog, filterShots, shotsToCandidates, watchCostUsd, watchMaxCostUsd, WATCH_DEFAULT_MODEL, REAL_FOOTAGE, SHOT_KINDS, WatchError, type Shot, type ShotKind, type WatchInput, type WatchResult } from './watch.ts'
export { planCut, detectSceneCuts, cutClip, cropFor, downloadWindow, CUT_MAX_S, type CutPlan } from './cut.ts'
export { buildSheet, grabFrame, clipFrames, sheetArgs } from './sheet.ts'
export { rankBySimilarity, signatureOf, similarity, ffmpegPixels, type PixelReader } from './similar.ts'
export { CostLedger, BudgetExceeded, footageBudget, type FootageBudget } from './budget.ts'
export { sourceFootage, type BeatResult, type ChainDeps, type ChainOptions, type ChainResult } from './chain.ts'
