import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { Theme } from '@earendil-works/pi-coding-agent'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

import type { LiveSubagent, SubagentManager } from './manager.js'
import {
  SubagentViewer,
  type SubagentViewerOptions,
  openSubagentViewer,
} from './viewer.js'

const ENTER = '\r'
const ESC = '\x1b'
const CTRL_C = '\x03'
const PAGE_DOWN = '\x1b[6~'

const makeTui = (): TUI =>
  ({
    terminal: { rows: 30, columns: 80 },
    requestRender: () => {},
  }) as unknown as TUI

const makeTheme = (): Theme =>
  ({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  }) as unknown as Theme

function makeSubagent(
  overrides: Partial<LiveSubagent['record']> = {},
  session: Partial<LiveSubagent['session']> = {},
): LiveSubagent {
  return {
    record: {
      id: 3,
      role: 'worker',
      title: 'Do the thing',
      status: 'running',
      activeTools: [],
      ...overrides,
    },
    session: {
      messages: [],
      subscribe: () => () => {},
      ...session,
    },
  } as unknown as LiveSubagent
}

function makeManager(
  overrides: Partial<Pick<SubagentManager, 'steer' | 'abort'>> = {},
): SubagentManager {
  return {
    get: () => undefined,
    steer: async () => makeSubagent(),
    abort: async () => true,
    ...overrides,
  } as unknown as SubagentManager
}

function makeViewer(
  subagent = makeSubagent(),
  manager = makeManager(),
  done: (result: undefined) => void = () => {},
  options: Partial<SubagentViewerOptions> = {},
) {
  return new SubagentViewer(makeTui(), makeTheme(), subagent, manager, done, {
    onSteer: options.onSteer ?? (() => {}),
    notify: options.notify,
  })
}

describe('SubagentViewer', () => {
  it('renders header, footer and content in view mode', () => {
    const component = makeViewer()
    const lines = component.render(120).join('\n')
    expect(lines).toContain('#3')
    expect(lines).toContain('Do the thing')
    expect(lines).toContain('enter steer')
    expect(lines).toContain('q/esc')
  })

  it('enters edit mode on enter when running', () => {
    const component = makeViewer()
    component.handleInput(ENTER)
    const lines = component.render(120).join('\n')
    expect(lines).toContain('shift+enter')
    expect(lines).toContain('Steer subagent #3:')
    expect(lines).not.toContain('q/esc')
    expect(lines).not.toContain('enter steer')
  })

  it('submits trimmed text via enter, fires onSteer and notifies info', async () => {
    const steered = makeSubagent()
    const steer = vi.fn(async () => steered)
    const onSteer = vi.fn()
    const notify = vi.fn()
    const component = makeViewer(
      makeSubagent(),
      makeManager({ steer }),
      () => {},
      { onSteer, notify },
    )
    component.handleInput(ENTER)
    component.handleInput('  hello world  ')
    component.handleInput(ENTER)
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledWith(3, 'hello world')
    })
    expect(onSteer).toHaveBeenCalledWith(steered, 'hello world')
    expect(notify).toHaveBeenCalledWith('Steered subagent #3.', 'info')
  })

  it('returns to view mode on escape without steering', () => {
    const steer = vi.fn(async () => makeSubagent())
    const onSteer = vi.fn()
    const component = makeViewer(
      makeSubagent(),
      makeManager({ steer }),
      () => {},
      {
        onSteer,
      },
    )
    component.handleInput(ENTER)
    component.handleInput(ESC)
    const lines = component.render(120).join('\n')
    expect(lines).toContain('enter steer')
    expect(lines).not.toContain('shift+enter')
    expect(steer).not.toHaveBeenCalled()
    expect(onSteer).not.toHaveBeenCalled()
  })

  it('ignores whitespace-only input and returns to view mode', () => {
    const steer = vi.fn(async () => makeSubagent())
    const onSteer = vi.fn()
    const component = makeViewer(
      makeSubagent(),
      makeManager({ steer }),
      () => {},
      {
        onSteer,
      },
    )
    component.handleInput(ENTER)
    component.handleInput('   ')
    component.handleInput(ENTER)
    expect(steer).not.toHaveBeenCalled()
    expect(onSteer).not.toHaveBeenCalled()
    expect(component.render(120).join('\n')).toContain('enter steer')
  })

  it('enters edit mode and steers a done subagent', async () => {
    const steer = vi.fn(async () => makeSubagent({ status: 'done' }))
    const onSteer = vi.fn()
    const component = makeViewer(
      makeSubagent({ status: 'done' }),
      makeManager({ steer }),
      () => {},
      { onSteer },
    )
    component.handleInput(ENTER)
    expect(component.render(120).join('\n')).toContain('shift+enter')
    component.handleInput('revisit edge cases')
    component.handleInput(ENTER)
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledWith(3, 'revisit edge cases')
    })
    expect(onSteer).toHaveBeenCalledOnce()
  })

  it('shows the steer hint in the footer for finished subagents', () => {
    const component = makeViewer(makeSubagent({ status: 'done' }))
    expect(component.render(120).join('\n')).toContain('enter steer')
  })

  it('steers a failed subagent like a done one', async () => {
    const steer = vi.fn(async () => makeSubagent({ status: 'failed' }))
    const onSteer = vi.fn()
    const component = makeViewer(
      makeSubagent({ status: 'failed' }),
      makeManager({ steer }),
      () => {},
      { onSteer },
    )
    component.handleInput(ENTER)
    expect(component.render(120).join('\n')).toContain('shift+enter')
    component.handleInput('retry with fewer tools')
    component.handleInput(ENTER)
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledWith(3, 'retry with fewer tools')
    })
    expect(onSteer).toHaveBeenCalledOnce()
  })

  it('steers a killed subagent via the restart path', async () => {
    const steer = vi.fn(async () => makeSubagent({ status: 'running' }))
    const onSteer = vi.fn()
    const notify = vi.fn()
    const component = makeViewer(
      makeSubagent({ status: 'killed' }),
      makeManager({ steer }),
      () => {},
      { onSteer, notify },
    )
    component.handleInput(ENTER)
    expect(component.render(120).join('\n')).toContain('shift+enter')
    component.handleInput('pick this back up')
    component.handleInput(ENTER)
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledWith(3, 'pick this back up')
    })
    expect(onSteer).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith('Steered subagent #3.', 'info')
  })
  it('aborts via x x in view mode', () => {
    const abort = vi.fn(async () => true)
    const component = makeViewer(makeSubagent(), makeManager({ abort }))
    component.handleInput('x')
    component.handleInput('x')
    expect(abort).toHaveBeenCalledWith(3)
  })

  it('closes the viewer via ctrl+c in edit mode', () => {
    let result: undefined | 'pending' = 'pending'
    const component = makeViewer(makeSubagent(), makeManager(), (r) => {
      result = r
    })
    component.handleInput(ENTER)
    component.handleInput(CTRL_C)
    expect(result).toBeUndefined()
  })

  it('notifies warning without firing onSteer when steer throws and stays open', async () => {
    const steer = vi.fn(async () => {
      throw new Error('steer budget exhausted')
    })
    const onSteer = vi.fn()
    const notify = vi.fn()
    let done = false
    const component = makeViewer(
      makeSubagent(),
      makeManager({ steer }),
      () => {
        done = true
      },
      { onSteer, notify },
    )
    component.handleInput(ENTER)
    component.handleInput('ping')
    component.handleInput(ENTER)
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        'Failed to steer subagent #3: steer budget exhausted',
        'warning',
      )
    })
    expect(onSteer).not.toHaveBeenCalled()
    expect(done).toBe(false)
    expect(component.render(120).join('\n')).toContain('enter steer')
  })

  it('scrolls history with pgdn in edit mode', () => {
    const message = Array.from({ length: 60 }, (_, i) => `line${i}`).join('\n')
    const session = {
      messages: [
        {
          role: 'user',
          content: message,
          timestamp: Date.now(),
        },
      ],
      subscribe: () => () => {},
    } as unknown as AgentSession
    const component = makeViewer(makeSubagent({}, session))
    const before = component.render(120).join('\n')
    component.handleInput(ENTER)
    component.handleInput(PAGE_DOWN)
    expect(component.render(120).join('\n')).not.toBe(before)
  })

  it('shrinks the scroll viewport in edit mode', () => {
    const message = Array.from({ length: 60 }, (_, i) => `line${i}`).join('\n')
    const session = {
      messages: [
        {
          role: 'user',
          content: message,
          timestamp: Date.now(),
        },
      ],
      subscribe: () => () => {},
    } as unknown as AgentSession
    const component = makeViewer(makeSubagent({}, session))
    component.render(120) // settle auto-follow at the view-mode viewport
    const viewLines = component.render(120)
    component.handleInput(ENTER)
    const editLines = component.render(120)
    // Same terminal rows: the editor chrome shrinks the transcript viewport,
    // so total render height stays within the overlay budget in edit mode.
    expect(editLines.length).toBeLessThanOrEqual(viewLines.length)
    expect(editLines.length).toBeGreaterThan(3)
  })
})

describe('openSubagentViewer', () => {
  it('warns and does not open the overlay for an unknown id', async () => {
    const notify = vi.fn()
    const custom = vi.fn()
    const ctx = {
      ui: { notify, custom },
    } as unknown as ExtensionContext
    const manager = makeManager()
    await openSubagentViewer(ctx, manager, 99, { onSteer: () => {} })
    expect(notify).toHaveBeenCalledWith('Subagent #99 not found.', 'warning')
    expect(custom).not.toHaveBeenCalled()
  })
})
