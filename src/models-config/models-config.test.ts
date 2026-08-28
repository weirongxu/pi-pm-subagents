import { describe, expect, it } from 'vitest'

import type { PiModesConfig } from './models-config.js'
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
