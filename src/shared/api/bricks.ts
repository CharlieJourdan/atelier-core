// IPC contract, module "bricks": the custom bricks an agent wrote for a channel (« Briques sur mesure », Production › Briques; docs/ENGINE-SPEC.md
// §25.2, docs/AGENT-RUNTIME.md §23). The renderer sees each brick's state, its last preview (stills as small data URLs, the lint verdict) and
// decides a proposal (the same answer as the inbox item: Valider, or Refuser with a note); « Demander une brique » is a message to Atlas.
// Every method added here must also be listed in BRICKS_METHODS (tests/unit/ipc.test.ts compares the list with what main implements).

export type CustomBrickState = 'draft' | 'review' | 'approved'

export interface CustomBrick {
  id: number
  channelId: number
  slug: string
  /** What an edit plan writes: `custom:<slug>`. */
  template: string
  name: string
  description: string
  /** The latest version (the draft or the one proposed). */
  version: number
  /** The version Charlie validated (what the channel's films use), or null. */
  approvedVersion: number | null
  state: CustomBrickState
  /** The channel's films use the validated version. */
  enabled: boolean
  /** Charlie's note when he sent it back. */
  note: string | null
  /** The inbox item of the open proposal. */
  inboxId: number | null
  /** The last preview of the latest version passed its lint (null: not previewed yet). */
  lintOk: boolean | null
  lint: string[]
  stills: { share: number; dataUrl: string }[]
  updatedAt: string
}

export interface BrickRequestInput {
  /** The channel the brick is for (null: Atlas asks which one). */
  channelId: number | null
  text: string
}

export interface BricksContract {
  'bricks.list': { args: []; result: CustomBrick[] }
  /** Validates the proposed version, or sends it back with a note (the agent revises it): the answer to its inbox item. */
  'bricks.decide': { args: [id: number, decision: { approve: boolean; note?: string }]; result: CustomBrick }
  /** Whether the channel's films use a validated brick. */
  'bricks.setEnabled': { args: [id: number, enabled: boolean]; result: CustomBrick }
  /** « Demander une brique »: a message to Atlas in the Supervisor chat. */
  'bricks.request': { args: [input: BrickRequestInput]; result: { conversationId: number } }
}

export const BRICKS_METHODS = ['bricks.list', 'bricks.decide', 'bricks.setEnabled', 'bricks.request'] as const satisfies readonly (keyof BricksContract)[]
