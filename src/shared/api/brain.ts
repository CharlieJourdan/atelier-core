// IPC contract, module "brain": where the app's brain runs. By default it is the app's own main process; once
// connected (Réglages › Ordinateur d'équipe) every call goes to the headless brain on the team computer
// (src/main/headless, docs/BRAIN-HEADLESS.md). The token never comes back to the renderer: only « set / not set ».
// Two ways there: a direct address + the brain's token (SSH tunnel), or « via Atelier Cloud » (the relay, with the
// person's Cloud session: no tunnel, no brain token).

/** A team computer of the person's team, as Atelier Cloud lists it (`GET /v1/team/machines`). */
export interface BrainCloudMachine {
  id: string
  status: string
  /** Its brain holds the relay open: « Se connecter via Atelier Cloud » reaches it. */
  online: boolean
  demo: boolean
}

export interface BrainStatus {
  /** 'local' = this app's own core answers; 'remote' = calls go to the team computer. */
  mode: 'local' | 'remote'
  /** Address of the team computer's brain (e.g. http://127.0.0.1:8790 through an SSH tunnel), null when local. */
  url: string | null
  /** Name shown in « Connecté à l'ordinateur d'équipe <name> »: the remote machine's hostname, else the URL's host. */
  name: string | null
  tokenSet: boolean
  /** The event stream of the remote brain is open (changes and chat replies arrive live). */
  live: boolean
  /** Last connection error (French), null when fine. */
  error: string | null
  /** Where the token is kept: the desktop app's encrypted secrets, or this browser tab (web app). */
  storage: 'secret' | 'session' | null
  /** How the remote brain is reached (absent when local). */
  via?: 'direct' | 'cloud'
  /** Present only when signed in to Atelier Cloud: the team's computers (refreshed in the background). */
  cloud?: { machines: BrainCloudMachine[]; checked: boolean; error: string | null }
}

/** Direct: `url` + `token`. Via Atelier Cloud: `{ via: 'cloud' }` (the Cloud session is the credential). */
export interface BrainConnectInput {
  url?: string
  token?: string
  via?: 'direct' | 'cloud'
}

export interface BrainContract {
  'brain.status': { args: []; result: BrainStatus }
  /** Checks the address and the token against the remote brain, then keeps them (token encrypted) and switches over. */
  'brain.connect': { args: [input: BrainConnectInput]; result: BrainStatus }
  /** Forgets the address and the token: the app's own core answers again. */
  'brain.disconnect': { args: []; result: BrainStatus }
}

export const BRAIN_METHODS = ['brain.status', 'brain.connect', 'brain.disconnect'] as const satisfies readonly (keyof BrainContract)[]
