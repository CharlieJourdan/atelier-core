// « Ordinateur d'équipe » with a headless brain behind app.machine: the brain's uptime, its restarts, and its last backup
// (on Atelier Cloud, on this computer only, kept but not sent, failed, or none yet), static renders.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BrainHealth } from '../../src/shared/api/app'
import { BrainHealthLines, fmtUptime } from '../../src/renderer/screens/team/BrainHealth'

const base: BrainHealth = { startedAt: '2026-10-31T10:00:00.000Z', uptimeS: 3 * 3600 + 5 * 60, restarts: 0, backup: null, nextBackupAt: '2026-11-01T02:30:00.000Z' }
const at = '2026-10-31T02:30:00.000Z'

describe('the team computer’s health lines', () => {
  it('formats the uptime', () => {
    expect(fmtUptime(59)).toBe('0 min')
    expect(fmtUptime(3 * 3600 + 5 * 60)).toBe('3 h 05 min')
    expect(fmtUptime(4 * 86400 + 3 * 3600)).toBe('4 j 3 h')
  })

  it('shows the uptime, the restarts and each backup state', () => {
    const html = (b: Partial<BrainHealth>): string => renderToStaticMarkup(<BrainHealthLines brain={{ ...base, ...b }} />)
    const none = html({})
    expect(none).toContain('Cerveau en marche depuis 3 h 05 min')
    expect(none).not.toContain('relancé')
    expect(none).toContain('Dernière sauvegarde : aucune pour l’instant')
    expect(none).toContain('data-state="none"')
    expect(none).toContain('prochaine')
    expect(html({ restarts: 2 })).toContain('relancé 2 fois par son gardien')
    const sent = html({ backup: { at, ok: true, sizeBytes: 12.4 * 1024 * 1024, cloud: 'sent', error: null } })
    expect(sent).toContain('12,4 Mo · sur Atelier Cloud')
    expect(sent).toContain('data-state="sent"')
    expect(html({ backup: { at, ok: true, sizeBytes: 40_000, cloud: 'off', error: null } })).toContain('39 Ko · sur cet ordinateur seulement')
    const notSent = html({ backup: { at, ok: true, sizeBytes: 1, cloud: 'failed', error: 'Atelier Cloud ne répond pas.' } })
    expect(notSent).toContain('gardée ici, pas envoyée : Atelier Cloud ne répond pas.')
    expect(notSent).toContain('data-state="bad"')
    expect(html({ backup: { at, ok: false, sizeBytes: 0, cloud: 'off', error: 'disque plein' } })).toContain('échec le')
  })
})
