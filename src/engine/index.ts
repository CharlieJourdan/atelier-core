// Atelier's production engine (docs/ENGINE-SPEC.md, PLAN-V2-PRODUCTION §1). Lot P2 built the core: node contract and
// registry, `atelier.pipeline/1` and its validator, fingerprints and the artefact store, the scheduler with events,
// cancel, retries and gates, and cost estimates. Lot P4 added the injected services and the nodes of a simple video
// (`./nodes`, `./pipelines/simple-video`, `./demo`). Pure TypeScript: no Electron, no src/main.
export * from './types'
export * from './artefacts'
export * from './canonical'
export * from './errors'
export * from './estimate'
export * from './executor'
export * from './events'
export * from './limits'
export * from './outputs'
export * from './pipeline-schema'
export * from './plan'
export * from './registry'
export * from './scheduler'
export * from './services'
export * from './state'
export * from './store'
export * from './validate'

/**
 * Version of the engine's contract; bumped by the lots that change it. 2 (lot P4): `RunCtx.services`, the artefact types
 * `text.input`, `json.outline`, `json.soundplan`, the error codes `missing_tool`, `bad_input`, `schema`, `verify_failed`.
 */
export const ENGINE_CONTRACT_VERSION = 2
