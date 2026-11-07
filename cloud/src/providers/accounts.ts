// Charlie's provider accounts (production-10, docs/PROVIDERS.md « Comptes et clés »): for each provider of the default chains,
// the vault entry it needs, the engines it serves and its priority (P0: the principal engines, P1: the fallbacks).
// `providers status` lists which are present (never their values) and which engines are enabled in config.json `realEngines`.
import type { Vault } from '../vault.ts'
import { HEYGEN_MCP_SECRET } from './heygen-oauth.ts'
import { UNIFICALLY_MODEL_ENGINES } from './unifically.ts'

export interface ProviderAccount {
  provider: string
  /** Vault entries it needs (all of them). */
  secrets: readonly string[]
  /** How the entry gets there, for the founder (no value ever in the command). */
  how: string
  engines: readonly string[]
  priority: 'P0' | 'P1'
}

const set = (name: string): string => `npm run cloud -- vault set ${name}`

export const PROVIDER_ACCOUNTS: readonly ProviderAccount[] = [
  { provider: 'HeyGen (forfait, MCP)', secrets: [HEYGEN_MCP_SECRET], how: 'npm run cloud -- providers signin heygen', engines: ['presenter:heygen-mcp'], priority: 'P0' },
  { provider: 'UnificAlly (Veo 3.1)', secrets: ['UNIFICALLY_API_KEY'], how: set('UNIFICALLY_API_KEY'), engines: ['clip:veo31-lite-relaxed', 'clip:veo31-lite', 'clip:veo31-fast', 'clip:veo31-fast-1080p', ...UNIFICALLY_MODEL_ENGINES], priority: 'P0' },
  { provider: 'OpenAI (GPT Image 2.5)', secrets: ['OPENAI_API_KEY'], how: set('OPENAI_API_KEY'), engines: ['image:gpt-image-25-low', 'image:gpt-image-25-medium', 'image:gpt-image-25-high'], priority: 'P0' },
  { provider: 'ai33.pro (voix)', secrets: ['AI33_API_KEY'], how: set('AI33_API_KEY'), engines: ['voice:ai33'], priority: 'P0' },
  { provider: 'MiniMax (voix, design de voix)', secrets: ['MINIMAX_API_KEY'], how: set('MINIMAX_API_KEY'), engines: ['voice:minimax-28-hd'], priority: 'P0' },
  { provider: 'HeyGen (API)', secrets: ['HEYGEN_API_KEY'], how: set('HEYGEN_API_KEY'), engines: ['presenter:heygen-avatar4'], priority: 'P1' },
  { provider: 'WaveSpeed', secrets: ['WAVESPEED_API_KEY'], how: set('WAVESPEED_API_KEY'), engines: ['presenter:pruna-avatar', 'presenter:infinitetalk-fast', 'presenter:infinitetalk-std'], priority: 'P1' },
  { provider: 'Kie.ai', secrets: ['KIE_API_KEY'], how: set('KIE_API_KEY'), engines: ['presenter:kling-avatar-kie', 'clip:veo31-lite-kie', 'image:gpt-image-25-kie'], priority: 'P1' },
  { provider: 'RunPod (InfiniteTalk)', secrets: ['RUNPOD_API_KEY'], how: set('RUNPOD_API_KEY'), engines: ['presenter:infinitetalk-gpu'], priority: 'P1' },
  {
    provider: 'Google Vertex AI (Veo, facultatif)',
    secrets: ['VERTEX_SERVICE_ACCOUNT_JSON'],
    how: 'Get-Content C:\\dev\\atelier-secrets\\vertex-sa.json -Raw | npm run cloud -- vault set VERTEX_SERVICE_ACCOUNT_JSON --from-stdin',
    engines: ['clip:veo31-lite-vertex'],
    priority: 'P1'
  },
  { provider: 'fal.ai', secrets: ['FAL_KEY'], how: set('FAL_KEY'), engines: ['image:gpt-image-25-fal-low', 'image:gpt-image-25-fal-medium'], priority: 'P1' },
  { provider: 'Cloudflare R2 (fichiers, plus tard)', secrets: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'], how: `${set('R2_ACCESS_KEY_ID')} ; ${set('R2_SECRET_ACCESS_KEY')}`, engines: [], priority: 'P1' },
]

export interface AccountStatus {
  provider: string
  priority: 'P0' | 'P1'
  /** Every vault entry it needs is there. */
  present: boolean
  missing: string[]
  /** Its engines listed in `realEngines`, and those that are not. */
  enabled: string[]
  disabled: string[]
}

/** Which accounts have their keys or sign-in in the vault (names only: no value is read). */
export function accountsStatus(vault: Pick<Vault, 'has' | 'available'>, realEngines: readonly string[]): AccountStatus[] {
  return PROVIDER_ACCOUNTS.map((a) => {
    const missing = a.secrets.filter((s) => !vault.available || !vault.has(s))
    return {
      provider: a.provider,
      priority: a.priority,
      present: missing.length === 0,
      missing,
      enabled: a.engines.filter((e) => realEngines.includes(e)),
      disabled: a.engines.filter((e) => !realEngines.includes(e))
    }
  })
}

/** The lines `providers status` prints for the accounts (French: the founder reads them). */
export function accountLines(rows: readonly AccountStatus[]): string[] {
  return rows.map((r) => {
    const state = r.present ? 'présent' : `manque ${r.missing.join(', ')}`
    const engines = r.enabled.length + r.disabled.length === 0 ? '' : `\tmoteurs actifs: ${r.enabled.length > 0 ? r.enabled.join(', ') : 'aucun'}`
    return `${r.priority}\t${r.provider}\t${state}${engines}`
  })
}
