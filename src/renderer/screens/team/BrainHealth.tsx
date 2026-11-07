// « Ordinateur d'équipe », when the app talks to the team computer's headless brain (app.machine carries `brain`): how
// long the brain has run, how often its keeper restarted it, and its last nightly backup (docs/BRAIN-HEADLESS.md §10).
import { CloudUpload, HardDrive, TriangleAlert } from 'lucide-react'
import type { BrainHealth } from '../../../shared/api/app'
import { t } from '../../../shared/fr'

/** 3 min, 2 h 05 min, 4 j 3 h. */
export function fmtUptime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  if (m < 60) return t('team.pc.dur.m', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('team.pc.dur.h', { h, m: String(m % 60).padStart(2, '0') })
  return t('team.pc.dur.d', { d: Math.floor(h / 24), h: h % 24 })
}

const when = (iso: string): string => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const size = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`)

function backupText(b: NonNullable<BrainHealth['backup']>): string {
  if (!b.ok) return t('team.pc.backup.failed', { at: when(b.at), error: b.error ?? '' })
  if (b.cloud === 'failed') return t('team.pc.backup.notSent', { at: when(b.at), error: b.error ?? '' })
  return t(b.cloud === 'sent' ? 'team.pc.backup.cloud' : 'team.pc.backup.local', { at: when(b.at), size: size(b.sizeBytes) })
}

export function BrainHealthLines({ brain }: { brain: BrainHealth }) {
  const b = brain.backup
  const bad = b !== null && (!b.ok || b.cloud === 'failed')
  const Icon = bad ? TriangleAlert : b?.cloud === 'sent' ? CloudUpload : HardDrive
  return (
    <div className="mt-3 flex flex-col gap-1 text-[12.5px] text-fg-2" data-testid="pc-brain">
      <p data-testid="pc-brain-uptime">
        {t('team.pc.brain.up', { d: fmtUptime(brain.uptimeS) })}
        {brain.restarts > 0 && <span className="text-fg-3"> · {t('team.pc.brain.restarts', { n: brain.restarts })}</span>}
      </p>
      <p className="flex items-center gap-1.5" data-testid="pc-backup" data-state={b === null ? 'none' : bad ? 'bad' : b.cloud}>
        <Icon className={bad ? 'size-3.5 shrink-0 text-warn' : 'size-3.5 shrink-0 text-fg-3'} aria-hidden />
        <span>
          {t('team.pc.backup')} : {b ? backupText(b) : t('team.pc.backup.none')}
          {brain.nextBackupAt && <span className="text-fg-3"> · {t('team.pc.backup.next', { at: when(brain.nextBackupAt) })}</span>}
        </span>
      </p>
    </div>
  )
}
