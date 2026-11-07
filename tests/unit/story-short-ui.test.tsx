// clone-reddit-shorts: « Nouvelle vidéo » on a story pipeline shows the background clips block (the channel's library, a way to fill it
// with free clips, or a folder of the owner's clips); without a channel it says why. Rendered in plain Node.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { t } from '../../src/shared/fr'
import { ClipLibraryField } from '../../src/renderer/screens/production/recettes/ClipLibraryField'

const noop = (): void => undefined

describe('the background clips of a story pipeline', () => {
  it('offers the free libraries and a folder for a channel', () => {
    const html = renderToStaticMarkup(<ClipLibraryField channelId={1} folder="" onFolder={noop} />)
    expect(html).toContain(t('clips.title'))
    expect(html).toContain('data-testid="clips-commons"')
    expect(html).toContain('data-testid="clips-cloud"')
    expect(html).toContain(t('clips.folder.placeholder'))
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/)
  })

  it('asks for a channel first', () => {
    const html = renderToStaticMarkup(<ClipLibraryField channelId={null} folder="" onFolder={noop} />)
    expect(html).toContain('Choisis une chaîne')
    expect(html).not.toContain('data-testid="clips-commons"')
  })
})
