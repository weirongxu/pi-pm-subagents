import { describe, expect, it } from 'vitest'

import type { PmSubagentsConfig } from './models-config.js'
import { sanitizeConfig } from './models-config.js'
import { MODEL_DEFAULT } from './subagent-model-constants.js'

describe('PmSubagentsConfig schema', () => {
  it('has subagentModelScope field', () => {
    const config: PmSubagentsConfig = {
      subagentModelScoped: [MODEL_DEFAULT, 'provider/model'],
    }
    expect(config.subagentModelScoped).toBeDefined()
    expect(config.subagentModelScoped?.length).toBe(2)
  })

  it('has subagentModel field', () => {
    const config: PmSubagentsConfig = {
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
    expect(sanitizeConfig({ defaultMode: 'bogus' })).toEqual({})
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

  it('keeps valid skipPluginAgents', () => {
    expect(sanitizeConfig({ skipPluginAgents: true })).toEqual({
      skipPluginAgents: true,
    })
  })

  it('clears invalid skipPluginAgents', () => {
    expect(
      sanitizeConfig({ skipPluginAgents: 'yes' as unknown as boolean }),
    ).toEqual({})
  })

  it('clears invalid defaultMode without affecting a valid subagentModel', () => {
    expect(
      sanitizeConfig({
        subagentModel: 'provider/model',
        defaultMode: 'bogus',
      }),
    ).toEqual({ subagentModel: 'provider/model' })
  })

  it('does not mutate the input record', () => {
    const record: PmSubagentsConfig = {
      subagentModel: 'no-slash',
      defaultMode: 'bogus',
    }
    sanitizeConfig(record)
    expect(record).toEqual({
      subagentModel: 'no-slash',
      defaultMode: 'bogus',
    })
  })
})
