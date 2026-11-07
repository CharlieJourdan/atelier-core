// The settings a recipe may set on one brick, as plain fields read from the technology's schema (`TechField`). An empty
// field is unset: the technology's default, or the channel style when it has none.
import { t, type MessageKey } from '../../../../shared/fr'
import type { TechField, TechnologyInfo } from '../../../../shared/recipes'
import { Input, Label, Select, Switch, Textarea } from '@/components/ui/input'
import { fieldText, parseField } from './recipe-model'

export const settingLabel = (key: string): string => t(`techSet.${key}` as MessageKey)

function Field({ field, value, onChange, id }: { field: TechField; value: unknown; onChange: (v: unknown) => void; id: string }) {
  const placeholder = field.default !== undefined ? fieldText(field.default) : t('recipeEd.settings.unset')
  if (field.type === 'boolean') {
    const on = typeof value === 'boolean' ? value : field.default === true
    return <Switch id={id} checked={on} onCheckedChange={(v) => onChange(v)} aria-label={settingLabel(field.key)} />
  }
  if (field.type === 'enum') {
    return (
      <Select id={id} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(parseField(field, e.target.value))}>
        <option value="">{placeholder}</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    )
  }
  if (field.type === 'list') {
    return <Textarea id={id} rows={2} value={fieldText(value)} placeholder={t('recipeEd.settings.listHint')} onChange={(e) => onChange(parseField(field, e.target.value))} />
  }
  const numeric = field.type === 'number' || field.type === 'integer'
  return (
    <Input
      id={id}
      inputMode={numeric ? 'decimal' : undefined}
      value={fieldText(value)}
      placeholder={placeholder}
      onChange={(e) => onChange(parseField(field, e.target.value))}
    />
  )
}

export function BrickSettings({ tech, settings, onChange, idPrefix }: { tech: TechnologyInfo; settings: Record<string, unknown>; onChange: (key: string, value: unknown) => void; idPrefix: string }) {
  const fields = tech.fields.filter((f) => f.recipe)
  if (fields.length === 0) return <p className="text-[12px] text-fg-3">{t('recipeEd.settings.none')}</p>
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid={`settings-${tech.name}`}>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`
        return (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{settingLabel(f.key)}</Label>
            <Field id={id} field={f} value={settings[f.key]} onChange={(v) => onChange(f.key, v)} />
          </div>
        )
      })}
    </div>
  )
}
