import type { Api, Model } from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BASH_READONLY_TOOL_NAME } from './bash-readonly.js'
import {
  applyModeModel,
  calculateModeTools,
  type ToolConfig,
  WRITE_TOOLS,
} from './mode-switcher.js'
import { baseToolsOf, restoreTools } from './mode-switcher.js'
import type { ModesState } from './types.js'
import { createState } from './utils/state.js'

function fakePi(initialActive: string[]): ExtensionAPI & {
  activeTools: string[]
} {
  const pi = {
    activeTools: initialActive,
    getActiveTools() {
      return [...pi.activeTools]
    },
    setActiveTools(names: string[]) {
      pi.activeTools = [...names]
    },
  }
  return pi as ExtensionAPI & { activeTools: string[] }
}

describe('calculateModeTools / restoreTools diff mechanism', () => {
  it('preserves tools registered during the mode and restores bash on exit', () => {
    const pi = fakePi(['read', 'write', 'bash'])
    const state: ModesState = createState()
    pi.setActiveTools(calculateModeTools(pi, state))
    expect(pi.activeTools).toEqual(['read', BASH_READONLY_TOOL_NAME])

    pi.activeTools.push('newtool')

    restoreTools(pi, state)
    expect(pi.activeTools).toContain('newtool')
    expect(pi.activeTools).toContain('write')
    expect(pi.activeTools).toContain('bash')
    expect(pi.activeTools).not.toContain(BASH_READONLY_TOOL_NAME)
    expect(state.modeDiffTools).toBeUndefined()
  })

  it('replays persisted modeTools idempotently and restores on exit', () => {
    const pi = fakePi(['read', BASH_READONLY_TOOL_NAME, 'grep'])
    const state: ModesState = {
      ...createState(),
      modeDiffTools: { added: [BASH_READONLY_TOOL_NAME], removed: ['bash'] },
    }

    pi.setActiveTools(calculateModeTools(pi, state))
    expect(pi.activeTools).toEqual(['read', BASH_READONLY_TOOL_NAME, 'grep'])
    expect(state.modeDiffTools).toEqual({
      added: [BASH_READONLY_TOOL_NAME],
      removed: ['bash'],
    })

    restoreTools(pi, state)
    expect(pi.activeTools).toEqual(['read', 'grep', 'bash'])
    expect(state.modeDiffTools).toBeUndefined()
  })

  it('baseToolsOf includes tools registered during the mode', () => {
    const pi = fakePi(['read', BASH_READONLY_TOOL_NAME, 'newtool'])
    const state: ModesState = {
      ...createState(),
      modeDiffTools: { added: [BASH_READONLY_TOOL_NAME], removed: ['bash'] },
    }

    const base = baseToolsOf(pi, state)
    expect(base).toContain('bash')
    expect(base).toContain('newtool')
    expect(base).toContain('read')
    expect(base).not.toContain(BASH_READONLY_TOOL_NAME)
  })

  it('baseToolsOf falls back to current active tools without a diff', () => {
    const pi = fakePi(['read', 'bash'])
    const state = createState()
    expect(baseToolsOf(pi, state)).toEqual(['read', 'bash'])
  })
})

describe('calculateModeTools', () => {
  it('defaults to read-only behavior when no config is provided', () => {
    const base = ['read', 'write', 'edit', 'bash', 'grep', 'find']
    const result = calculateModeTools(fakePi(base), createState(), {})
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).toContain('grep')
    expect(result).toContain('find')
    expect(result).not.toContain('write')
    expect(result).not.toContain('edit')
    expect(result).not.toContain('bash')
  })

  it('adds extra tools to the result', () => {
    const base = ['read', 'write', 'bash']
    const config: ToolConfig = {
      extraTools: ['subagent_delegate', 'subagent_kill'],
    }
    const result = calculateModeTools(fakePi(base), createState(), config)
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).toContain('subagent_delegate')
    expect(result).toContain('subagent_kill')
  })

  it('removes tools specified in removeTools', () => {
    const base = ['read', 'write', 'bash', 'grep', 'find']
    const config: ToolConfig = {
      removeTools: ['grep', 'find'],
    }
    const result = calculateModeTools(fakePi(base), createState(), config)
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).not.toContain('grep')
    expect(result).not.toContain('find')
  })

  it('applies tools whitelist when tools is specified', () => {
    const base = ['read', 'write', 'bash', 'grep', 'find']
    const config: ToolConfig = {
      tools: ['read', BASH_READONLY_TOOL_NAME],
    }
    const result = calculateModeTools(fakePi(base), createState(), config)
    expect(result).toEqual(['read', BASH_READONLY_TOOL_NAME])
  })

  it('combines extraTools and removeTools correctly', () => {
    const base = ['read', 'write', 'bash', 'grep', 'find']
    const config: ToolConfig = {
      extraTools: ['subagent_delegate'],
      removeTools: ['grep'],
    }
    const result = calculateModeTools(fakePi(base), createState(), config)
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).toContain('find')
    expect(result).toContain('subagent_delegate')
    expect(result).not.toContain('grep')
  })

  it('combines tools, extraTools, and removeTools correctly', () => {
    const base = ['read', 'write', 'bash', 'grep', 'find', 'ls']
    const config: ToolConfig = {
      tools: ['read', 'grep', 'subagent_delegate'],
      extraTools: ['subagent_delegate'],
      removeTools: ['find', 'ls'],
    }
    const result = calculateModeTools(fakePi(base), createState(), config)
    expect(result).toContain('read')
    expect(result).toContain('grep')
    expect(result).toContain('subagent_delegate')
    expect(result).not.toContain(BASH_READONLY_TOOL_NAME)
    expect(result).not.toContain('find')
    expect(result).not.toContain('ls')
  })

  it('handles empty arrays correctly', () => {
    const base = ['read', 'write', 'bash']
    const config: ToolConfig = {
      tools: [],
      extraTools: [],
      removeTools: [],
    }
    const result = calculateModeTools(fakePi(base), createState(), config)
    expect(result).toEqual([])
  })

  it('handles undefined fields correctly', () => {
    const base = ['read', 'write', 'bash', 'grep']
    const config: ToolConfig = {
      tools: undefined,
      extraTools: undefined,
      removeTools: undefined,
    }
    const result = calculateModeTools(fakePi(base), createState(), config)
    expect(result).toContain('read')
    expect(result).toContain(BASH_READONLY_TOOL_NAME)
    expect(result).toContain('grep')
  })

  it('removes all write tools from base', () => {
    const base = ['read', 'write', 'edit', 'bash']
    const result = calculateModeTools(fakePi(base), createState(), {})
    for (const tool of WRITE_TOOLS) {
      expect(result).not.toContain(tool)
    }
  })

  it('keeps extraTools even when tools whitelist does not include them', () => {
    const config: ToolConfig = {
      tools: ['read', 'grep'],
      extraTools: ['subagent_delegate'],
    }
    const result = calculateModeTools(fakePi([]), createState(), config)
    expect(result).toContain('read')
    expect(result).toContain('grep')
    expect(result).toContain('subagent_delegate')
  })
})

describe('applyModeModel', () => {
  const mockModel: Model<Api> = {
    provider: 'anthropic',
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
  } as Model<Api>

  const mockState: ModesState = {
    mode: undefined,
    modeDiffTools: undefined,
    previousModel: undefined,
  }

  const setModelMock = vi.fn().mockResolvedValue(true)
  const findModelMock = vi.fn().mockReturnValue(mockModel)
  const notifyMock = vi.fn()

  const mockPi = {
    setModel: setModelMock,
  } as unknown as Parameters<typeof applyModeModel>[0]

  const mockCtx = {
    model: mockModel,
    modelRegistry: {
      find: findModelMock,
    },
    ui: {
      notify: notifyMock,
      theme: {},
    },
  } as unknown as Parameters<typeof applyModeModel>[2]

  beforeEach(() => {
    vi.clearAllMocks()
    mockState.previousModel = undefined
    setModelMock.mockResolvedValue(true)
    findModelMock.mockReturnValue(mockModel)
    mockCtx.model = mockModel
  })

  it('does nothing when modelRef is undefined', async () => {
    await applyModeModel(mockPi, mockState, mockCtx, undefined)
    expect(mockState.previousModel).toBeUndefined()
    expect(setModelMock).not.toHaveBeenCalled()
  })

  it('does nothing when modelRef is empty string', async () => {
    await applyModeModel(mockPi, mockState, mockCtx, '')
    expect(mockState.previousModel).toBeUndefined()
    expect(setModelMock).not.toHaveBeenCalled()
  })

  it('successfully switches to valid model', async () => {
    const modelRef = 'anthropic/claude-sonnet-4-5'
    await applyModeModel(mockPi, mockState, mockCtx, modelRef)

    expect(mockState.previousModel).toBe('anthropic/claude-sonnet-4-5')
    expect(findModelMock).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-5')
    expect(setModelMock).toHaveBeenCalledWith(mockModel)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('shows warning for invalid model ref', async () => {
    const modelRef = 'invalid-model-ref'
    await applyModeModel(mockPi, mockState, mockCtx, modelRef)

    expect(mockState.previousModel).toBeUndefined()
    expect(notifyMock).toHaveBeenCalledWith(
      'Invalid model ref: invalid-model-ref',
      'warning',
    )
    expect(setModelMock).not.toHaveBeenCalled()
  })

  it('shows warning when model is not found', async () => {
    findModelMock.mockReturnValue(undefined)
    const modelRef = 'anthropic/claude-sonnet-4-5'
    await applyModeModel(mockPi, mockState, mockCtx, modelRef)

    expect(mockState.previousModel).toBeUndefined()
    expect(notifyMock).toHaveBeenCalledWith(
      'Invalid model ref: anthropic/claude-sonnet-4-5',
      'warning',
    )
    expect(setModelMock).not.toHaveBeenCalled()
  })

  it('shows error when API key is not available', async () => {
    setModelMock.mockResolvedValue(false)
    const modelRef = 'anthropic/claude-sonnet-4-5'
    await applyModeModel(mockPi, mockState, mockCtx, modelRef)

    expect(mockState.previousModel).toBeUndefined()
    expect(notifyMock).toHaveBeenCalledWith(
      'No API key for this model',
      'error',
    )
    expect(setModelMock).toHaveBeenCalledWith(mockModel)
  })

  it('skips recording previousModel if it already exists', async () => {
    mockState.previousModel = 'openai/gpt-4'
    const modelRef = 'anthropic/claude-sonnet-4-5'
    await applyModeModel(mockPi, mockState, mockCtx, modelRef)

    expect(mockState.previousModel).toBe('openai/gpt-4')
    expect(setModelMock).toHaveBeenCalledWith(mockModel)
  })

  it('does not record previousModel when current model is undefined', async () => {
    mockCtx.model = undefined
    const modelRef = 'anthropic/claude-sonnet-4-5'
    await applyModeModel(mockPi, mockState, mockCtx, modelRef)
    expect(mockState.previousModel).toBeUndefined()
    expect(setModelMock).toHaveBeenCalledWith(mockModel)
  })
})
