// IPC contract, module "example" (lot Z1): the example workspace: status, load, delete in one click.
// Every method added here must also be listed in EXAMPLE_METHODS and counted, with a comment, in its area's unit test.

export interface ExampleStatus {
  /** The example workspace is in the database. */
  loaded: boolean
  /** Ids of the example channels: their rows (and their videos) carry the EXEMPLE chip. */
  channelIds: number[]
  /** The user deleted it at least once (the app then never loads it again by itself). */
  deleted: boolean
}

export interface ExampleContract {
  'example.status': { args: []; result: ExampleStatus }
  /** Loads the invented channels, videos and figures (refused while loaded). */
  'example.load': { args: []; result: ExampleStatus }
  /** Deletes every row marked example, in one transaction. */
  'example.delete': { args: []; result: ExampleStatus }
}

export const EXAMPLE_METHODS = ['example.status', 'example.load', 'example.delete'] as const satisfies readonly (keyof ExampleContract)[]
