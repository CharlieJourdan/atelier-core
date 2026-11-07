// agents-production: « J'ai mon script » in Production › Nouvelle vidéo, in the built app on the fakes. On a pipeline whose
// Script option is « je l'importe », the form takes the owner's script (pasted, or read from a .txt file) instead of an
// idea; the project carries it as its `script` input. A project of that pipeline without a script is refused in French
// before anything runs (never the engine's raw « required inputs missing », no orphan run).
import { expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { noDesktopReason } from './desktop'
import { api, launchAtelier, type Atelier } from './launch'

const skipReason = noDesktopReason()
const SCRIPT = 'Aujourd’hui, on purge un radiateur. On coupe le chauffage, on attend, puis on ouvre la vis avec douceur. On referme quand l’eau coule.'

test.describe('« J’ai mon script »: the owner’s script becomes the project’s input', () => {
  test.skip(skipReason !== null, `No interactive desktop: ${skipReason}`)
  test.setTimeout(3 * 60_000)
  let atelier: Atelier

  test.beforeAll(async () => {
    atelier = await launchAtelier({ name: 'team-script', runner: false })
    await atelier.page.setViewportSize({ width: 1440, height: 900 })
  })
  test.afterAll(async () => {
    await atelier?.close()
  })

  test('paste or a .txt file in the form; no script = a French refusal before the run', async () => {
    const { page } = atelier
    const base = (await api(page, 'recipes.fromBase', 'avatar@1', 'Mes scripts')) as { id: number }
    const recipe = (await api(page, 'recipes.edit', base.id, [{ op: 'setOption', option: 'script', value: 'import' }])) as { id: number }
    const channel = (await api(page, 'channels.create', { name: 'Marcel', niche: 'bricolage' })) as { id: number }
    await page.reload()
    await page.getByTestId('rail-production').click()
    await page.getByTestId('page-production-bibliotheque').click()
    await page.getByTestId('project-new').click()
    const form = page.getByTestId('new-project')
    await page.locator('#project-recipe').selectOption(String(recipe.id))
    await page.locator('#project-channel').selectOption({ label: 'Marcel' })
    await form.getByLabel('Titre').fill('Purger un radiateur')
    await page.getByTestId('project-mode-script').click()
    // a .txt file fills the script field
    const dir = mkdtempSync(path.join(tmpdir(), 'atelier-e2e-script-'))
    const file = path.join(dir, 'marcel-2-script.txt')
    writeFileSync(file, SCRIPT, 'utf8')
    await page.getByTestId('script-file-input').setInputFiles(file)
    await expect(page.getByTestId('script-text')).toHaveValue(SCRIPT)
    await expect(page.getByTestId('script-words')).toContainText('mots')
    await page.getByTestId('project-create').click()
    const projects = async () => (await api(page, 'projects.list', { channelId: channel.id })) as { id: number; title: string }[]
    await expect.poll(async () => (await projects()).length, { timeout: 10_000 }).toBe(1)
    const made = (await api(page, 'projects.get', (await projects())[0]?.id)) as { inputs: Record<string, string>; idea: string }
    expect(made.inputs.script).toBe(SCRIPT)
    expect(made.idea).toBe('Purger un radiateur')

    // the same pipeline without a script: refused in French before anything runs
    const empty = (await api(page, 'projects.create', { recipeId: recipe.id, channelId: channel.id, title: 'Sans script', idea: 'Une idée' })) as { id: number }
    const refused = await api(page, 'projects.run', empty.id).then(
      () => null,
      (e: unknown) => String(e instanceof Error ? e.message : e)
    )
    expect(refused).toMatch(/Il manque le script/)
    expect(await api(page, 'production.list')).toEqual([])
  })
})
