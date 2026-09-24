import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { MessageBatcher, SubagentMessageType } from './batcher.js'
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { LiveSubagent } from './manager.js'
import type { PmSubagentState } from '../types.js'
import { buildSpawnOptions } from './spawn-options.js'
import { createState } from '../utils/state.js'
import { join } from 'node:path'
import { setRuntime } from '../coordinator/runtime.js'
import { tmpdir } from 'node:os'

const askHowToProceedMock = vi.hoisted(() => vi.fn())

vi.mock('../ui/review-pager.js', () => ({
  askHowToProceed: askHowToProceedMock,
}))

function makeSubagent(): LiveSubagent {
  return {
    record: {
      id: 3,
      title: 'Plan the thing',
      previousEntries: [],
      prompt: 'Plan it',
      status: 'done',
      startedAt: Date.now() - 1000,
      steerCount: 0,
      activeTools: [],
      role: 'planner',
      cwd: '/tmp/proj',
      sessionFile: '/tmp/proj/sessions/x.jsonl',
    },
  } as unknown as LiveSubagent
}

function makeManagerMock() {
  return {
    steer: vi.fn(async () => makeSubagent()),
  }
}

function setup(): {
  batcherItems: string[]
  manager: ReturnType<typeof makeManagerMock>
} {
  const batcherItems: string[] = []
  const manager = makeManagerMock()
  setRuntime({
    manager: manager as never,
    activityReporter: {} as never,
    demoSubagentManager: undefined,
    fleet: {} as never,
    batcher: {
      add: (
        _subagent: LiveSubagent,
        _type: SubagentMessageType,
        message: string,
      ) => {
        batcherItems.push(message)
      },
    } as unknown as MessageBatcher,
  })
  return { batcherItems, manager }
}

function makeRole() {
  return {
    fm: { reviewOnEnd: 'review' },
    systemPrompt: 'sp',
  } as Parameters<typeof buildSpawnOptions>[3]
}

function makePi(): ExtensionAPI {
  return {
    getActiveTools: () => [],
    setActiveTools: () => {},
  } as unknown as ExtensionAPI
}

function makeArgs(state: PmSubagentState) {
  return {
    pi: makePi(),
    state,
    ctx: {
      cwd: '/tmp/proj',
      hasUI: true,
      ui: { notify: vi.fn() },
    } as unknown as ExtensionContext,
  }
}

describe('buildSpawnOptions revise flow', () => {
  it('pushes title, follows up and enqueues a steer item with the full revise prompt', async () => {
    const { batcherItems, manager } = setup()
    const state: PmSubagentState = { ...createState(), mode: 'coordinator' }
    const { pi, ctx } = makeArgs(state)
    const subagent = makeSubagent()

    const options = buildSpawnOptions(pi, state, ctx, makeRole(), 'planner')

    // Capture the review choices and trigger the revise path.
    askHowToProceedMock.mockImplementation(async (_ctx, pagerOptions) => {
      const revise = pagerOptions.choices.find(
        (choice: { id: string }) => choice.id === 'revise',
      )
      await revise?.action('revise with full context')
    })
    await options.onComplete?.(subagent, 'the plan')

    expect(manager.steer).toHaveBeenCalledWith(3, 'revise with full context', {
      title: 'Plan the thing (r1)',
    })
    expect(batcherItems).toEqual(['revise with full context'])
  })

  it('does not enqueue a steer item when the user only sends the review', async () => {
    const { batcherItems } = setup()
    const state: PmSubagentState = { ...createState(), mode: 'coordinator' }
    const { pi, ctx } = makeArgs(state)

    const options = buildSpawnOptions(pi, state, ctx, makeRole(), 'planner')

    askHowToProceedMock.mockImplementation(async (_ctx, pagerOptions) => {
      const send = pagerOptions.choices.find(
        (choice: { id: string }) => choice.id === 'send',
      )
      await send?.action()
    })
    await options.onComplete?.(makeSubagent(), 'the plan')

    expect(batcherItems).toEqual(['the plan'])
  })

  it('save action writes the review file', async () => {
    setup()
    const state: PmSubagentState = { ...createState(), mode: 'coordinator' }
    const { pi, ctx } = makeArgs(state)
    const dir = await mkdtemp(join(tmpdir(), 'spawn-save-'))
    ctx.cwd = dir

    const options = buildSpawnOptions(pi, state, ctx, makeRole(), 'planner')

    askHowToProceedMock.mockImplementation(async (_ctx, pagerOptions) => {
      const save = pagerOptions.choices.find(
        (choice: { id: string }) => choice.id === 'save',
      )
      await save?.action()
    })
    await options.onComplete?.(makeSubagent(), 'the plan')

    expect(
      await readFile(join(dir, '.pi', 'plan', 'Plan the thing.md'), 'utf8'),
    ).toBe('the plan\n')
    const notify = (
      ctx as unknown as { ui: { notify: ReturnType<typeof vi.fn> } }
    ).ui.notify
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining(join(dir, '.pi', 'plan', 'Plan the thing.md')),
      'info',
    )

    await rm(dir, { recursive: true, force: true })
  })

  it('uses reviewOnEnd for UI copy and subagent title for the saved file name', async () => {
    setup()
    const state: PmSubagentState = { ...createState(), mode: 'coordinator' }
    const { pi, ctx } = makeArgs(state)
    const dir = await mkdtemp(join(tmpdir(), 'spawn-save-'))
    ctx.cwd = dir

    const options = buildSpawnOptions(pi, state, ctx, makeRole(), 'planner')

    let pagerOptions:
      | {
          title?: string
          choices?: Array<{ id: string; label: string }>
        }
      | undefined
    askHowToProceedMock.mockImplementation(async (_ctx, opts) => {
      pagerOptions = opts
      const save = opts.choices.find(
        (choice: { id: string }) => choice.id === 'save',
      )
      await save?.action()
    })
    await options.onComplete?.(makeSubagent(), 'the plan')

    expect(pagerOptions?.title).toBe('📋 Review Review')
    expect(pagerOptions?.choices?.[0]?.label).toBe('Send review to coordinator')
    expect(
      await readFile(join(dir, '.pi', 'plan', 'Plan the thing.md'), 'utf8'),
    ).toBe('the plan\n')

    await rm(dir, { recursive: true, force: true })
  })

  it('save action sanitizes illegal filename characters from the title', async () => {
    setup()
    const state: PmSubagentState = { ...createState(), mode: 'coordinator' }
    const { pi, ctx } = makeArgs(state)
    const dir = await mkdtemp(join(tmpdir(), 'spawn-save-'))
    ctx.cwd = dir
    const subagent = makeSubagent()
    subagent.record.title = 'Plan: a/b <thing>?'

    const options = buildSpawnOptions(pi, state, ctx, makeRole(), 'planner')

    askHowToProceedMock.mockImplementation(async (_ctx, pagerOptions) => {
      const save = pagerOptions.choices.find(
        (choice: { id: string }) => choice.id === 'save',
      )
      await save?.action()
    })
    await options.onComplete?.(subagent, 'the plan')

    expect(
      await readFile(join(dir, '.pi', 'plan', 'Plan- a-b -thing.md'), 'utf8'),
    ).toBe('the plan\n')

    await rm(dir, { recursive: true, force: true })
  })
})
