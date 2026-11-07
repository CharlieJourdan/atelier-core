// The form over every field of an `atelier.style/1` sheet (PLAN-V2-PRODUCTION §3). Controlled: the parent keeps the draft.
import type * as React from 'react'
import { t } from '../../../../shared/fr'
import type { StyleBlock, StyleSheet } from '../../../../shared/analysis'
import { BUDGET_MODE_IDS } from '../../../../shared/gauge'
import { Field } from '@/components/atelier/kit'
import { Panel } from '@/components/atelier/primitives'
import { Input, Select, Switch, Textarea } from '@/components/ui/input'

type Patch<K extends StyleBlock> = Partial<StyleSheet[K]>
export interface StyleFormProps {
  sheet: StyleSheet
  onChange: (next: StyleSheet) => void
  disabled?: boolean
}

const SKILLS = ['hook', 'retention', 'rehooks', 'factcheck', 'cta'] as const
const MIX = ['stock', 'ai_image', 'ai_video', 'animation', 'footage', 'avatar'] as const

const lines = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter(Boolean)
const csv = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)

function Num({ id, label, value, onValue, step = 1, min, max, disabled }: { id: string; label: string; value: number; onValue: (n: number) => void; step?: number; min?: number; max?: number; disabled?: boolean }) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(disabled ? { disabled } : {})}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onValue(n)
        }}
      />
    </Field>
  )
}

function Txt({ id, label, value, onValue, disabled, hint }: { id: string; label: string; value: string; onValue: (s: string) => void; disabled?: boolean; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <Input id={id} value={value} {...(disabled ? { disabled } : {})} onChange={(e) => onValue(e.target.value)} />
    </Field>
  )
}

function Area({ id, label, value, onValue, disabled, hint, rows = 3 }: { id: string; label: string; value: string; onValue: (s: string) => void; disabled?: boolean; hint?: string; rows?: number }) {
  return (
    <Field label={label} htmlFor={id} {...(hint ? { hint } : {})}>
      <Textarea id={id} rows={rows} value={value} {...(disabled ? { disabled } : {})} onChange={(e) => onValue(e.target.value)} />
    </Field>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>
}

export function StyleForm({ sheet, onChange, disabled }: StyleFormProps) {
  const set = <K extends StyleBlock>(block: K, patch: Patch<K>) => onChange({ ...sheet, [block]: { ...sheet[block], ...patch } })
  const d = disabled === true
  return (
    <div className="flex flex-col gap-4" data-testid="style-form">
      <Panel title={t('styles.block.identity')}>
        <Grid>
          <Txt id="st-name" label={t('styles.identity.name')} value={sheet.identity.name} disabled={d} onValue={(name) => set('identity', { name })} />
          <Txt id="st-niche" label={t('styles.identity.niche')} value={sheet.identity.niche} disabled={d} onValue={(niche) => set('identity', { niche })} />
          <Txt id="st-lang" label={t('styles.identity.language')} value={sheet.identity.language} disabled={d} onValue={(language) => set('identity', { language })} />
          <Txt id="st-audience" label={t('styles.identity.audience')} value={sheet.identity.audience} disabled={d} onValue={(audience) => set('identity', { audience })} />
        </Grid>
      </Panel>

      <Panel title={t('styles.block.voice')}>
        <Grid>
          <Field label={t('styles.voice.source')} htmlFor="st-vsrc">
            <Select id="st-vsrc" value={sheet.voice.source} disabled={d} onChange={(e) => set('voice', { source: e.target.value === 'own' ? 'own' : 'platform' })}>
              <option value="platform">{t('styles.voice.platform')}</option>
              <option value="own">{t('styles.voice.own')}</option>
            </Select>
          </Field>
          <Txt id="st-vid" label={t('styles.voice.id')} value={sheet.voice.voiceId} disabled={d} onValue={(voiceId) => set('voice', { voiceId })} />
          <Num id="st-vspeed" label={t('styles.voice.speed')} value={sheet.voice.speed} step={0.05} min={0.5} max={2} disabled={d} onValue={(speed) => set('voice', { speed })} />
          <Num id="st-vstab" label={t('styles.voice.stability')} value={sheet.voice.stability} step={0.05} min={0} max={1} disabled={d} onValue={(stability) => set('voice', { stability })} />
        </Grid>
      </Panel>

      <Panel title={t('styles.block.script')}>
        <Grid>
          <Area id="st-structure" label={t('styles.script.structure')} hint={t('styles.script.structureHint')} value={sheet.script.structure.join('\n')} disabled={d} onValue={(v) => set('script', { structure: lines(v) })} />
          <div className="flex flex-col gap-3">
            <Txt id="st-hook" label={t('styles.script.hook')} value={sheet.script.hook} disabled={d} onValue={(hook) => set('script', { hook })} />
            <Txt id="st-tone" label={t('styles.script.tone')} value={sheet.script.tone} disabled={d} onValue={(tone) => set('script', { tone })} />
          </div>
          <Num id="st-wpm" label={t('styles.script.wpm')} value={sheet.script.wpm} min={60} max={300} disabled={d} onValue={(wpm) => set('script', { wpm: Math.round(wpm) })} />
          <Num id="st-len" label={t('styles.script.lengthMin')} value={sheet.script.lengthMin} min={1} max={120} disabled={d} onValue={(lengthMin) => set('script', { lengthMin })} />
          <Txt id="st-forbid" label={t('styles.script.forbidden')} hint={t('styles.csvHint')} value={sheet.script.forbidden.join(', ')} disabled={d} onValue={(v) => set('script', { forbidden: csv(v) })} />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[12px] font-medium text-fg-2">{t('styles.script.skills')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {SKILLS.map((s) => (
                <label key={s} className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
                  <input
                    type="checkbox"
                    checked={sheet.script.skills.includes(s)}
                    disabled={d}
                    className="accent-[var(--brand)]"
                    onChange={(e) => set('script', { skills: e.target.checked ? [...sheet.script.skills, s] : sheet.script.skills.filter((x) => x !== s) })}
                  />
                  {t(`styles.skill.${s}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </Grid>
      </Panel>

      <Panel title={t('styles.block.visuals')}>
        <p className="mb-3 text-[11.5px] text-fg-3">{t('styles.visuals.mixHint')}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {MIX.map((k) => (
            <Num
              key={k}
              id={`st-mix-${k}`}
              label={t(`styles.mix.${k}`)}
              value={sheet.visuals.mix[k]}
              step={0.05}
              min={0}
              max={1}
              disabled={d}
              onValue={(n) => set('visuals', { mix: { ...sheet.visuals.mix, [k]: n } })}
            />
          ))}
        </div>
        <div className="mt-3">
          <Grid>
            <Txt id="st-palette" label={t('styles.visuals.palette')} hint={t('styles.paletteHint')} value={sheet.visuals.palette.join(', ')} disabled={d} onValue={(v) => set('visuals', { palette: csv(v) })} />
            <Txt id="st-fonts" label={t('styles.visuals.fonts')} hint={t('styles.csvHint')} value={sheet.visuals.fonts.join(', ')} disabled={d} onValue={(v) => set('visuals', { fonts: csv(v) })} />
            <Txt id="st-grade" label={t('styles.visuals.grade')} value={sheet.visuals.grade} disabled={d} onValue={(grade) => set('visuals', { grade })} />
          </Grid>
        </div>
      </Panel>

      <Panel title={t('styles.block.animation')}>
        <Grid>
          <Txt id="st-kit" label={t('styles.animation.kit')} value={sheet.animation.kit} disabled={d} onValue={(kit) => set('animation', { kit })} />
          <Txt id="st-aset" label={t('styles.animation.settings')} value={sheet.animation.settings} disabled={d} onValue={(settings) => set('animation', { settings })} />
        </Grid>
      </Panel>

      <Panel title={t('styles.block.captions')}>
        <Grid>
          <Txt id="st-cpreset" label={t('styles.captions.preset')} value={sheet.captions.preset} disabled={d} onValue={(preset) => set('captions', { preset })} />
          <Field label={t('styles.captions.position')} htmlFor="st-cpos">
            <Select id="st-cpos" value={sheet.captions.position} disabled={d} onChange={(e) => set('captions', { position: e.target.value === 'top' ? 'top' : e.target.value === 'middle' ? 'middle' : 'bottom' })}>
              <option value="bottom">{t('styles.captions.bottom')}</option>
              <option value="middle">{t('styles.captions.middle')}</option>
              <option value="top">{t('styles.captions.top')}</option>
            </Select>
          </Field>
          <Num id="st-cwords" label={t('styles.captions.wordsPerLine')} value={sheet.captions.wordsPerLine} min={1} max={12} disabled={d} onValue={(n) => set('captions', { wordsPerLine: Math.round(n) })} />
          <Field label={t('styles.captions.highlight')}>
            <Switch checked={sheet.captions.highlight} disabled={d} aria-label={t('styles.captions.highlight')} onCheckedChange={(highlight) => set('captions', { highlight })} />
          </Field>
        </Grid>
      </Panel>

      <Panel title={t('styles.block.sound')}>
        <Grid>
          <Txt id="st-mood" label={t('styles.sound.mood')} value={sheet.sound.mood} disabled={d} onValue={(mood) => set('sound', { mood })} />
          <Num id="st-vol" label={t('styles.sound.volume')} value={sheet.sound.volume} step={0.05} min={0} max={1} disabled={d} onValue={(volume) => set('sound', { volume })} />
          <Num id="st-duck" label={t('styles.sound.duckDb')} value={sheet.sound.duckDb} min={0} max={30} disabled={d} onValue={(duckDb) => set('sound', { duckDb })} />
        </Grid>
      </Panel>

      <Panel title={t('styles.block.pace')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Num id="st-cuts" label={t('styles.pace.cuts')} value={sheet.pace.cutsPerMinute} min={1} max={60} disabled={d} onValue={(cutsPerMinute) => set('pace', { cutsPerMinute })} />
          <Num id="st-minshot" label={t('styles.pace.minShot')} value={sheet.pace.minShotS} step={0.5} min={0.5} max={10} disabled={d} onValue={(minShotS) => set('pace', { minShotS })} />
          <Num id="st-maxshot" label={t('styles.pace.maxShot')} value={sheet.pace.maxShotS} step={0.5} min={1} max={30} disabled={d} onValue={(maxShotS) => set('pace', { maxShotS })} />
        </div>
      </Panel>

      <Panel title={t('styles.block.thumbnail')}>
        <Grid>
          <Txt id="st-tlayout" label={t('styles.thumbnail.layout')} value={sheet.thumbnail.layout} disabled={d} onValue={(layout) => set('thumbnail', { layout })} />
          <Txt id="st-trules" label={t('styles.thumbnail.textRules')} value={sheet.thumbnail.textRules} disabled={d} onValue={(textRules) => set('thumbnail', { textRules })} />
          <Txt id="st-tcolors" label={t('styles.thumbnail.colors')} hint={t('styles.paletteHint')} value={sheet.thumbnail.colors.join(', ')} disabled={d} onValue={(v) => set('thumbnail', { colors: csv(v) })} />
          <Field label={t('styles.thumbnail.face')}>
            <Switch checked={sheet.thumbnail.face} disabled={d} aria-label={t('styles.thumbnail.face')} onCheckedChange={(face) => set('thumbnail', { face })} />
          </Field>
        </Grid>
      </Panel>

      <Panel title={t('styles.block.packaging')}>
        <Grid>
          <Area id="st-titles" label={t('styles.packaging.titleRules')} value={sheet.packaging.titleRules} disabled={d} onValue={(titleRules) => set('packaging', { titleRules })} />
          <Area id="st-desc" label={t('styles.packaging.descriptionTemplate')} rows={5} value={sheet.packaging.descriptionTemplate} disabled={d} onValue={(descriptionTemplate) => set('packaging', { descriptionTemplate })} />
        </Grid>
      </Panel>

      <Panel title={t('styles.block.budget')}>
        <Grid>
          <Field label={t('styles.budget.mode')} htmlFor="st-bmode">
            <Select id="st-bmode" value={sheet.budget.mode} disabled={d} onChange={(e) => set('budget', { mode: e.target.value === 'qualite_max' ? 'qualite_max' : 'usage_max' })}>
              {BUDGET_MODE_IDS.map((m) => (
                <option key={m} value={m}>
                  {t(`analysis.mode.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('styles.budget.cap')} htmlFor="st-bcap" hint={t('styles.budget.capHint')}>
            <Input
              id="st-bcap"
              type="number"
              min={0}
              value={sheet.budget.capCredits ?? ''}
              disabled={d}
              onChange={(e) => {
                const raw = e.target.value
                set('budget', { capCredits: raw === '' ? null : Math.max(0, Number(raw) || 0) })
              }}
            />
          </Field>
        </Grid>
      </Panel>
    </div>
  )
}
