import type { Api, Model } from '@earendil-works/pi-ai'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { MODEL_DEFAULT } from './subagent-model-constants.js'
import {
  cycleSubagentModel,
  formatSubagentModelLabel,
  resolveSubagentModelForSpawn,
} from './subagent-model-utils.js'

describe('cycleSubagentModel', () => {
  describe('empty scope', () => {
    it('throws', () => {
      expect(() => cycleSubagentModel([], undefined, 1)).toThrow(
        'subagent model scope must be non-empty',
      )
    })
  })

  describe('single element scope', () => {
    it('always returns index 0 regardless of direction', () => {
      const scope = ['anthropic/claude-haiku-4-5']
      expect(cycleSubagentModel(scope, undefined, 1)).toEqual({
        ref: 'anthropic/claude-haiku-4-5',
        index: 0,
        poolSize: 1,
      })
      expect(
        cycleSubagentModel(scope, 'anthropic/claude-haiku-4-5', 1),
      ).toEqual({
        ref: 'anthropic/claude-haiku-4-5',
        index: 0,
        poolSize: 1,
      })
      expect(
        cycleSubagentModel(scope, 'anthropic/claude-haiku-4-5', -1),
      ).toEqual({
        ref: 'anthropic/claude-haiku-4-5',
        index: 0,
        poolSize: 1,
      })
    })
  })

  describe('multiple elements scope', () => {
    const scope = ['model-a', 'model-b', 'model-c']

    it('cycles forward wrapping around', () => {
      expect(cycleSubagentModel(scope, 'model-a', 1)).toEqual({
        ref: 'model-b',
        index: 1,
        poolSize: 3,
      })
      expect(cycleSubagentModel(scope, 'model-b', 1)).toEqual({
        ref: 'model-c',
        index: 2,
        poolSize: 3,
      })
      expect(cycleSubagentModel(scope, 'model-c', 1)).toEqual({
        ref: 'model-a',
        index: 0,
        poolSize: 3,
      })
    })

    it('cycles backward wrapping around', () => {
      expect(cycleSubagentModel(scope, 'model-a', -1)).toEqual({
        ref: 'model-c',
        index: 2,
        poolSize: 3,
      })
      expect(cycleSubagentModel(scope, 'model-c', -1)).toEqual({
        ref: 'model-b',
        index: 1,
        poolSize: 3,
      })
      expect(cycleSubagentModel(scope, 'model-b', -1)).toEqual({
        ref: 'model-a',
        index: 0,
        poolSize: 3,
      })
    })

    it('handles undefined currentRef as first element', () => {
      expect(cycleSubagentModel(scope, undefined, 1)).toEqual({
        ref: 'model-b',
        index: 1,
        poolSize: 3,
      })
      expect(cycleSubagentModel(scope, undefined, -1)).toEqual({
        ref: 'model-c',
        index: 2,
        poolSize: 3,
      })
    })

    it('handles currentRef not in scope as first element', () => {
      expect(cycleSubagentModel(scope, 'unknown-model', 1)).toEqual({
        ref: 'model-b',
        index: 1,
        poolSize: 3,
      })
    })
  })
})

describe('formatSubagentModelLabel', () => {
  it('returns ref for empty scope', () => {
    expect(formatSubagentModelLabel([], 'model-a')).toBe('model-a')
    expect(formatSubagentModelLabel([], MODEL_DEFAULT)).toBe(MODEL_DEFAULT)
    expect(formatSubagentModelLabel([], undefined)).toBe(MODEL_DEFAULT)
  })

  it('shows ref with index and pool size when scope is non-empty', () => {
    const scope = ['model-a', 'model-b', 'model-c']
    expect(formatSubagentModelLabel(scope, 'model-a')).toBe('model-a (1/3)')
    expect(formatSubagentModelLabel(scope, 'model-b')).toBe('model-b (2/3)')
    expect(formatSubagentModelLabel(scope, 'model-c')).toBe('model-c (3/3)')
  })

  it('shows ref without index when scope is empty', () => {
    expect(formatSubagentModelLabel([], 'model-a')).toBe('model-a')
    expect(formatSubagentModelLabel([], MODEL_DEFAULT)).toBe(MODEL_DEFAULT)
    expect(formatSubagentModelLabel([], undefined)).toBe(MODEL_DEFAULT)
  })

  it('shows ref without index when ref not found in scope', () => {
    const scope = ['model-a', 'model-b']
    expect(formatSubagentModelLabel(scope, 'unknown')).toBe('unknown')
  })

  it('shows MODEL_DEFAULT without index when ref is undefined and not in scope', () => {
    const scope = ['model-a', 'model-b']
    expect(formatSubagentModelLabel(scope, undefined)).toBe(MODEL_DEFAULT)
  })

  it('shows MODEL_DEFAULT with index when ref is undefined and DEFAULT is in scope', () => {
    const scope = [MODEL_DEFAULT, 'model-a', 'model-b']
    expect(formatSubagentModelLabel(scope, undefined)).toBe('DEFAULT (1/3)')
  })
})

describe('resolveSubagentModelForSpawn', () => {
  function makeFakeModel(provider: string, id: string): Model<Api> {
    return {
      provider,
      id,
      name: `${provider}/${id}`,
      api: 'openai-responses',
      baseUrl: `https://${provider}.example.com`,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    }
  }

  function makeFakeCtx(
    registry: Record<string, Model<Api>>,
    currentModel: Model<Api>,
  ): ExtensionContext {
    return {
      modelRegistry: {
        find: (provider: string, id: string) =>
          registry[`${provider}/${id}`] ?? null,
        getAvailable: () => Object.values(registry),
        getModel: (provider: string, id: string) =>
          registry[`${provider}/${id}`] ?? null,
        getProviders: () => [],
        getModels: () => [],
        checkAuth: async () => undefined,
        refresh: async () => ({ aborted: false, errors: new Map() }),
        getAuth: async () => undefined,
        login: async () => {
          throw new Error('not implemented')
        },
        logout: async () => {},
        stream: () => {
          throw new Error('not implemented')
        },
        complete: async () => {
          throw new Error('not implemented')
        },
        streamSimple: () => {
          throw new Error('not implemented')
        },
        completeSimple: async () => {
          throw new Error('not implemented')
        },
      },
      model: currentModel,
    } as unknown as ExtensionContext
  }

  const modelA = makeFakeModel('provider-a', 'model-a')
  const modelB = makeFakeModel('provider-b', 'model-b')
  const ctxModel = makeFakeModel('default', 'ctx-model')

  it('returns sessionModel when it is a valid model ref', () => {
    const ctx = makeFakeCtx(
      { 'provider-a/model-a': modelA, 'provider-b/model-b': modelB },
      ctxModel,
    )
    const result = resolveSubagentModelForSpawn(
      ctx,
      undefined,
      'provider-a/model-a',
    )
    expect(result).toBe(modelA)
  })

  it('falls back to ctx.model when both roleModel and sessionModel are undefined', () => {
    const ctx = makeFakeCtx({ 'default/ctx-model': ctxModel }, ctxModel)
    const result = resolveSubagentModelForSpawn(ctx, undefined, undefined)
    expect(result).toBe(ctxModel)
  })

  it('roleModel takes priority over sessionModel', () => {
    const ctx = makeFakeCtx(
      { 'provider-a/model-a': modelA, 'provider-b/model-b': modelB },
      ctxModel,
    )
    const result = resolveSubagentModelForSpawn(
      ctx,
      'provider-b/model-b',
      'provider-a/model-a',
    )
    expect(result).toBe(modelB)
  })

  it('falls back to ctx.model when sessionModel is not in registry', () => {
    const ctx = makeFakeCtx({}, ctxModel)
    const result = resolveSubagentModelForSpawn(ctx, undefined, 'unknown/model')
    expect(result).toBe(ctxModel)
  })

  it('falls back to ctx.model when sessionModel is MODEL_DEFAULT', () => {
    const ctx = makeFakeCtx({ 'default/ctx-model': ctxModel }, ctxModel)
    const result = resolveSubagentModelForSpawn(ctx, undefined, MODEL_DEFAULT)
    expect(result).toBe(ctxModel)
  })

  it('sessionModel undefined falls back to MODEL_DEFAULT then ctx.model', () => {
    const ctx = makeFakeCtx({ 'default/ctx-model': ctxModel }, ctxModel)
    const result = resolveSubagentModelForSpawn(ctx, undefined, undefined)
    expect(result).toBe(ctxModel)
  })
})
