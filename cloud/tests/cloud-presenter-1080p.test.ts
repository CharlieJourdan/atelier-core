// avatar-qualite: the presenter is asked in 1080p (`avatar.speak` default): the request HeyGen's servers receive carries it,
// on the plan's MCP server and on the API (same price at 720p and 1080p).
import { describe, expect, it } from 'vitest'
import { PRESENTER_ENGINE_CAN, resolutionFor } from '../../src/shared/presenter-engines.ts'
import { createArgs } from '../src/providers/heygen-mcp.ts'
import { resolutionOf, type AvatarInput } from '../src/providers/presenter-common.ts'

const input = (resolution: AvatarInput['resolution']): AvatarInput => ({ avatarId: 'a', seconds: 5, aspect: '16:9', resolution }) as AvatarInput

describe('the HeyGen request asks for 1080p', () => {
  it('MCP (the plan) and API: 1080p asked, 1080p sent, the API at the same price as 720p', () => {
    for (const engine of ['presenter:heygen-mcp', 'presenter:heygen-avatar4'] as const) expect(resolutionOf(engine, input(resolutionFor(engine, '1080p') as AvatarInput['resolution']), 'test')).toBe('1080p')
    expect(createArgs('img', 'aud', resolutionOf('presenter:heygen-mcp', input('1080p'), 'test'), '16:9', undefined)).toMatchObject({ resolution: '1080p', aspectRatio: '16:9' })
    const api = PRESENTER_ENGINE_CAN['presenter:heygen-avatar4'].usdPerS
    expect(api['1080p']).toBe(api['720p'])
  })
})
