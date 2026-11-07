// IPC contract, module "tools" (lot Z1): Mes outils: tool manifests, permissions, test console and run history.
// Every method added here must also be listed in TOOLS_METHODS and counted, with a comment, in its area's unit test.
import type { DryRunResult, ToolDetail, ToolRow, ToolRunRow, ToolValidation } from '../tools'

export interface ToolVersionImport {
  tool: ToolDetail
  /** Permission ids the new version asks for beyond what was granted: they stay off until the user grants them. */
  newPermissions: string[]
}

export interface ToolsContract {
  'tools.list': { args: []; result: ToolRow[] }

  'tools.get': { args: [slug: string]; result: ToolDetail }

  /** Validates the text of a manifest (French errors per path) and previews the permissions it asks for. */
  'tools.validate': { args: [manifestText: string]; result: ToolValidation }

  /** Adds a tool from a manifest; the user accepted every requested permission. */
  'tools.add': { args: [manifestText: string]; result: ToolDetail }

  'tools.delete': { args: [slug: string]; result: void }

  'tools.setEnabled': { args: [slug: string, enabled: boolean]; result: ToolDetail }

  'tools.setPermission': { args: [slug: string, permissionId: string, granted: boolean]; result: ToolDetail }

  /** Which agents may use the tool. */
  'tools.setAgents': { args: [slug: string, agentIds: string[]]; result: ToolDetail }

  /** Stores a secret value (write-only: it is never returned). */
  'tools.setSecret': { args: [slug: string, name: string, value: string]; result: ToolDetail }

  'tools.clearSecret': { args: [slug: string, name: string]; result: ToolDetail }

  /** Imports a new manifest version of an existing tool and makes it the active one. */
  'tools.importVersion': { args: [slug: string, manifestText: string]; result: ToolVersionImport }

  /** Makes a stored version the active one again (one-click rollback). */
  'tools.activateVersion': { args: [slug: string, version: string]; result: ToolVersionImport }

  /** Test console: validates the inputs, renders what would run, checks permissions and secrets, records a dry run. */
  'tools.dryRun': { args: [slug: string, input: Record<string, unknown>]; result: DryRunResult }

  'tools.runs': { args: [slug?: string]; result: ToolRunRow[] }
}

export const TOOLS_METHODS = [
  'tools.list',
  'tools.get',
  'tools.validate',
  'tools.add',
  'tools.delete',
  'tools.setEnabled',
  'tools.setPermission',
  'tools.setAgents',
  'tools.setSecret',
  'tools.clearSecret',
  'tools.importVersion',
  'tools.activateVersion',
  'tools.dryRun',
  'tools.runs'
] as const satisfies readonly (keyof ToolsContract)[]
