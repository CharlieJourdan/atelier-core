// scripts/vps-brain.mjs (vps-essai): the test team's brain inside the simulated team VPS. The box is the VPS of decision
// 0084 (4 vCPU / 8 GB, no swap), its disk a Docker volume (not a Windows bind mount), the code read-only, the brain's port
// on the host's loopback only, and an init process as PID 1: the keeper is not an init, and the ffmpeg of a brain killed
// mid-render stayed as zombies under it.
import { describe, expect, it } from 'vitest'

interface Mod {
  parseArgs(argv: string[]): Record<string, unknown> & { name: string }
  boxArgs(o: unknown, port: number | null): string[]
  brainArgs(o: unknown): string[]
  BOX_DATA: string
}
const modPath = '../../scripts/vps-brain.mjs'
const load = (): Promise<Mod> => import(modPath) as Promise<Mod>

const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

describe('vps-brain', () => {
  it('runs the box with the VPS limits, an init, its own volume, the code read-only and the port on loopback', async () => {
    const m = await load()
    const o = m.parseArgs(['start', '--data', 'C:/inputs/vps-essai/brain', '--token-file', 'C:/secrets/t.token'])
    expect(o.name).toBe('atelier-vps-vps-essai')
    const a = m.boxArgs(o, 51000)
    expect(a).toContain('--init')
    expect(after(a, '--cpus')).toBe('4')
    expect(after(a, '--memory')).toBe('8g')
    expect(after(a, '--memory-swap')).toBe('8g')
    expect(a).toContain('atelier-vps-vps-essai:/vps')
    expect(a.filter((x) => x.endsWith(':ro')).length).toBeGreaterThanOrEqual(5)
    expect(a).toContain('127.0.0.1:51000:8790')
  })

  it('starts the brain on the box disk, signed in to the test team, without MCP or backups', async () => {
    const m = await load()
    const b = m.brainArgs(m.parseArgs(['start', '--data', 'x', '--cloud-url', 'https://cloud.example']))
    expect(after(b, '--data')).toBe(m.BOX_DATA)
    expect(after(b, '--token-file')).toBe('/secrets/test-brain.token')
    expect(after(b, '--cloud-url')).toBe('https://cloud.example')
    expect(b).toEqual(expect.arrayContaining(['--no-mcp', '--no-backup', '--host', '0.0.0.0']))
  })
})
