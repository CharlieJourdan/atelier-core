// Réglages › Discord: Atlas on the phone. The walk: paste the bot token (masked, never shown again) → invite the bot →
// pick the server → « Tout créer » → switch the bridge on. Everything is real (no demo): the token is checked with Discord
// by the main process and stored encrypted; this page only ever sees « set / not set ».
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { DiscordGuild, DiscordInvite, DiscordNotifications, DiscordSetupResult, DiscordStatus } from '../../../../shared/api/discord'
import { t, type MessageKey } from '../../../../shared/fr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select, Switch } from '@/components/ui/input'
import { toast } from '@/lib/toast'
import { call, errText, useApi } from '@/state/client'
import type { ScreenProps } from '../../registry'
import { Block, Loaded, PrefsPage, SettingRow } from './common'

function Step({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <Block title={title}>
      <div className="flex flex-col gap-3" data-testid={`discord-step-${id}`}>
        {children}
      </div>
    </Block>
  )
}

function TokenStep({ status, onChanged }: { status: DiscordStatus; onChanged: () => void }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await call('discord.setToken', draft)
      // The field is emptied at once: the token is never kept in the page.
      setDraft('')
      toast.success(t('prefs.discord.token.ok', { name: next.bot?.name ?? '' }))
      onChanged()
    } catch (err) {
      toast.error(t('prefs.saveError'), errText(err))
    } finally {
      setBusy(false)
    }
  }
  const clear = async (): Promise<void> => {
    await call('discord.clearToken')
    toast.success(t('prefs.discord.token.cleared'))
    onChanged()
  }
  return (
    <Step title={t('prefs.discord.step1')} id="token">
      <p className="text-[12.5px] text-fg-3">{t('prefs.discord.token.help')}</p>
      <div className="flex items-center gap-2">
        <Badge variant={status.tokenSet ? 'ok' : 'default'} data-testid="discord-token-state" data-set={status.tokenSet}>
          {status.tokenSet ? t('prefs.discord.token.set') : t('prefs.discord.token.notSet')}
        </Badge>
        {status.bot && <span className="text-[12.5px] text-fg-2">{t('prefs.discord.bot', { name: status.bot.name })}</span>}
        {status.tokenSet && <span className="text-[12px] text-fg-3">{t('prefs.discord.token.hidden')}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          aria-label={t('prefs.discord.token.label')}
          placeholder={t('prefs.discord.token.placeholder')}
          data-testid="discord-token-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() && !busy) void save()
          }}
        />
        <Button size="sm" disabled={busy || !draft.trim()} data-testid="discord-token-save" onClick={() => void save()}>
          {busy ? t('prefs.discord.token.saving') : t('prefs.discord.token.save')}
        </Button>
        {status.tokenSet && (
          <Button size="sm" variant="ghost" data-testid="discord-token-clear" onClick={() => void clear()}>
            {t('prefs.discord.token.clear')}
          </Button>
        )}
      </div>
    </Step>
  )
}

function InviteStep({ invite }: { invite: DiscordInvite | null }) {
  const [copied, setCopied] = useState(false)
  return (
    <Step title={t('prefs.discord.step2')} id="invite">
      <p className="text-[12.5px] text-fg-3">{t('prefs.discord.invite.note')}</p>
      {invite ? (
        <div className="flex items-center gap-2">
          <a
            href={invite.url}
            target="_blank"
            rel="noreferrer"
            data-testid="discord-invite"
            className="inline-flex h-8 items-center rounded-full bg-brand px-3 text-xs font-medium text-ink-fg hover:opacity-90"
          >
            {t('prefs.discord.invite.open')}
          </a>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(invite.url).then(() => setCopied(true))
            }}
          >
            {copied ? t('prefs.discord.invite.copied') : t('prefs.discord.invite.copy')}
          </Button>
        </div>
      ) : (
        <p className="text-[12.5px] text-fg-3">{t('prefs.discord.needToken')}</p>
      )}
    </Step>
  )
}

function CreateStep({ status, guilds, reloadGuilds, onChanged }: { status: DiscordStatus; guilds: DiscordGuild[] | null; reloadGuilds: () => void; onChanged: () => void }) {
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<DiscordSetupResult | null>(null)
  const guildId = picked || status.guild?.id || guilds?.[0]?.id || ''
  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      setDone(await call('discord.setup', guildId))
      onChanged()
    } catch (err) {
      toast.error(t('prefs.saveError'), errText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Step title={t('prefs.discord.step3')} id="server">
        {!status.tokenSet ? (
          <p className="text-[12.5px] text-fg-3">{t('prefs.discord.needToken')}</p>
        ) : guilds && guilds.length === 0 ? (
          <p className="text-[12.5px] text-fg-3">{t('prefs.discord.guilds.none')}</p>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={guildId} aria-label={t('prefs.discord.guilds.pick')} data-testid="discord-guild-select" onChange={(e) => setPicked(e.target.value)}>
              {(guilds ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={reloadGuilds}>
              {t('prefs.discord.guilds.refresh')}
            </Button>
          </div>
        )}
      </Step>
      <Step title={t('prefs.discord.step4')} id="create">
        <p className="text-[12.5px] text-fg-3">{t('prefs.discord.create.note')}</p>
        <div>
          <Button size="sm" disabled={busy || !status.tokenSet || !guildId} data-testid="discord-create" onClick={() => void create()}>
            {busy ? t('prefs.discord.creating') : t('prefs.discord.create')}
          </Button>
        </div>
        {done && <p className="text-[12.5px] text-ok">{t('prefs.discord.create.done', { created: done.created, reused: done.reused })}</p>}
        {status.channels.length > 0 && (
          <ul className="flex flex-col gap-1" data-testid="discord-channels">
            {status.channels.map((c) => (
              <li key={c.discordId} className="flex items-center gap-2 text-[13px] text-fg">
                <span className="font-mono text-[12px]">#{c.name}</span>
                <span className="text-[12px] text-fg-3">{t(`prefs.discord.room.${c.key}` as 'prefs.discord.room.atlas')}</span>
              </li>
            ))}
          </ul>
        )}
      </Step>
    </>
  )
}

function BridgeStep({ status, onChanged }: { status: DiscordStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [users, setUsers] = useState<string | null>(null)
  const ready = status.tokenSet && status.channels.length > 0
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast.success(ok)
      onChanged()
    } catch (err) {
      toast.error(t('prefs.saveError'), errText(err))
    } finally {
      setBusy(false)
    }
  }
  const state = status.enabled ? (status.running ? t('prefs.discord.bridge.on') : t('prefs.discord.bridge.stopped')) : t('prefs.discord.bridge.off')
  return (
    <Step title={t('prefs.discord.step5')} id="bridge">
      <SettingRow label={t('prefs.discord.bridge')} hint={t('prefs.discord.bridge.hint')}>
        <Badge variant={status.running ? 'ok' : 'default'} data-testid="discord-bridge-state">
          {state}
        </Badge>
        <Switch
          checked={status.enabled}
          disabled={busy || (!ready && !status.enabled)}
          aria-label={t('prefs.discord.bridge')}
          data-testid="discord-bridge-switch"
          onCheckedChange={(on) => void run(() => call('discord.setEnabled', on))}
        />
      </SettingRow>
      {!ready && <p className="text-[12.5px] text-fg-3">{t(status.tokenSet ? 'prefs.discord.needCreate' : 'prefs.discord.needToken')}</p>}
      {status.enabled && !status.teamOn && <p className="text-[12.5px] text-warn" data-testid="discord-team-off">{t('prefs.discord.teamOff')}</p>}
      {status.contentIntentMissing && <p className="text-[12.5px] text-warn">{t('prefs.discord.intent')}</p>}
      {status.lastPollAt && <p className="text-[12px] text-fg-3">{t('prefs.discord.lastPoll', { time: new Date(status.lastPollAt).toLocaleTimeString() })}</p>}
      {status.lastError && <p className="text-[12.5px] text-err" data-testid="discord-error">{t('prefs.discord.error', { message: status.lastError })}</p>}
      <SettingRow label={t('prefs.discord.summary')} hint={t('prefs.discord.summary.hint')}>
        <Select
          className="w-28"
          value={status.summaryHour === null ? '' : String(status.summaryHour)}
          aria-label={t('prefs.discord.summary')}
          onChange={(e) => void run(() => call('discord.configure', { summaryHour: e.target.value === '' ? null : Number(e.target.value) }))}
        >
          <option value="">{t('prefs.discord.summary.none')}</option>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {t('prefs.discord.summary.at', { h })}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow label={t('prefs.discord.weekly')} hint={t('prefs.discord.weekly.hint')}>
        <Select
          className="w-32"
          value={status.weeklyDay === null ? '' : String(status.weeklyDay)}
          aria-label={t('prefs.discord.weekly')}
          data-testid="discord-weekly"
          onChange={(e) => void run(() => call('discord.configure', { weeklyDay: e.target.value === '' ? null : Number(e.target.value) }))}
        >
          <option value="">{t('prefs.discord.weekly.none')}</option>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <option key={d} value={d}>
              {t(`goals.day.${d}` as MessageKey)}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow label={t('prefs.discord.notify')} hint={t('prefs.discord.notify.hint')}>
        <Select
          className="w-56"
          value={status.notifications}
          aria-label={t('prefs.discord.notify')}
          data-testid="discord-notify"
          onChange={(e) => void run(() => call('discord.configure', { notifications: e.target.value as DiscordNotifications }))}
        >
          {(['important', 'everything', 'nothing'] as const).map((n) => (
            <option key={n} value={n}>
              {t(`prefs.discord.notify.${n}` as MessageKey)}
            </option>
          ))}
        </Select>
      </SettingRow>
      {status.enabled && (
        <p className={status.buttonsLive ? 'text-[12.5px] text-fg-3' : 'text-[12.5px] text-warn'} data-testid="discord-buttons">
          {t(status.buttonsLive ? 'prefs.discord.buttons.live' : 'prefs.discord.buttons.off')}
        </p>
      )}
      <SettingRow label={t('prefs.discord.users')} hint={t('prefs.discord.users.hint')}>
        <Input
          className="w-64"
          value={users ?? status.allowedUserIds.join(', ')}
          aria-label={t('prefs.discord.users')}
          onChange={(e) => setUsers(e.target.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || users === null}
          onClick={() =>
            void run(
              () => call('discord.configure', { allowedUserIds: (users ?? '').split(/[\s,;]+/).filter(Boolean) }),
              t('prefs.saved')
            ).then(() => setUsers(null))
          }
        >
          {t('prefs.discord.users.save')}
        </Button>
      </SettingRow>
      <div>
        <Button size="sm" variant="secondary" disabled={busy || status.channels.length === 0} data-testid="discord-test" onClick={() => void run(() => call('discord.test'), t('prefs.discord.test.ok'))}>
          {t('prefs.discord.test')}
        </Button>
      </div>
    </Step>
  )
}

export function DiscordBody({ status, reload }: { status: DiscordStatus; reload: () => void }) {
  const [invite, setInvite] = useState<DiscordInvite | null>(null)
  const [guilds, setGuilds] = useState<DiscordGuild[] | null>(null)
  const [tick, setTick] = useState(0)
  const reloadGuilds = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => {
    let live = true
    if (!status.tokenSet) return
    void call('discord.inviteUrl').then((v) => live && setInvite(v), () => undefined)
    void call('discord.guilds').then((v) => live && setGuilds(v), () => live && setGuilds([]))
    return () => {
      live = false
    }
  }, [status.tokenSet, tick])
  return (
    <>
      <p className="text-[12.5px] text-fg-3">{t('prefs.discord.off')}</p>
      <TokenStep status={status} onChanged={reload} />
      <InviteStep invite={status.tokenSet ? invite : null} />
      <CreateStep status={status} guilds={status.tokenSet ? guilds : null} reloadGuilds={reloadGuilds} onChanged={reload} />
      <BridgeStep status={status} onChanged={reload} />
    </>
  )
}

export function DiscordPage(_props: ScreenProps) {
  const status = useApi('discord.status', ['discord', 'orchestra'])
  return (
    <PrefsPage page="discord">
      <Loaded data={status.data} error={status.error} onRetry={status.reload}>
        {(s) => <DiscordBody status={s} reload={status.reload} />}
      </Loaded>
    </PrefsPage>
  )
}
