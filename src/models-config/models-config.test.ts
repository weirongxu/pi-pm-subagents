import { describe, expect, it } from 'vitest'

import type { PiModesConfig } from './models-config.js'
import { sanitizeConfig } from './models-config.js'
import { MODEL_DEFAULT } from './subagent-model-constants.js'

describe('PiModesConfig schema', () => {
  it('has subagentModelScope field', () => {
    const config: PiModesConfig = {
      subagentModelScoped: [MODEL_DEFAULT, 'provider/model'],
    }
    expect(config.subagentModelScoped).toBeDefined()
    expect(config.subagentModelScoped?.length).toBe(2)
  })

  it('has subagentModel field', () => {
    const config: PiModesConfig = {
      subagentModel: 'anthropic/claude-sonnet-4-5',
    }
    expect(config.subagentModel).toBe('anthropic/claude-sonnet-4-5')
  })
})

describe('sanitizeConfig', () => {
  it('keeps defaultMode when it is coordinator', () => {
    expect(sanitizeConfig({ defaultMode: 'coordinator' })).toEqual({
      defaultMode: 'coordinator',
    })
  })

  it('clears invalid defaultMode', () => {
    expect(sanitizeConfig({ defaultMode: 'plan' })).toEqual({})
  })

  it('keeps valid subagentModel and scope', () => {
    const config = sanitizeConfig({
      subagentModel: 'provider/model',
      subagentModelScoped: ['provider/model', MODEL_DEFAULT],
    })
    expect(config.subagentModel).toBe('provider/model')
    expect(config.subagentModelScoped).toEqual([
      'provider/model',
      MODEL_DEFAULT,
    ])
  })

  it('clears invalid subagentModel and empty scope', () => {
    const config = sanitizeConfig({
      subagentModel: 'no-slash',
      subagentModelScoped: ['also-bad'],
    })
    expect(config.subagentModel).toBeUndefined()
    expect(config.subagentModelScoped).toBeUndefined()
  })

  it('clears invalid defaultMode without affecting a valid subagentModel', () => {
    expect(
      sanitizeConfig({
        subagentModel: 'provider/model',
        defaultMode: 'plan',
      }),
    ).toEqual({ subagentModel: 'provider/model' })
  })

  it('does not mutate the input record', () => {
    const record: PiModesConfig = {
      subagentModel: 'no-slash',
      defaultMode: 'plan',
    }
    sanitizeConfig(record)
    expect(record).toEqual({
      subagentModel: 'no-slash',
      defaultMode: 'plan',
    })
  })
})
