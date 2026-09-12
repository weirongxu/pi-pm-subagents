import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { Theme } from '@earendil-works/pi-coding-agent'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

import type { LiveSubagent, SubagentManager } from './manager.js'
import { openSubagentViewer, SubagentViewer } from './viewer.js'

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

function makeSubagent(overrides: Partial<LiveSubagent> = {}): LiveSubagent {
  return {
    id: 3,
    role: 'worker',
    title: 'Do the thing',
    status: 'running',
    activeTools: [],
    session: {
      messages: [],
      subscribe: () => () => {},
    },
    ...overrides,
  } as unknown as LiveSubagent
}

function makeManager(
  overrides: Partial<Pick<SubagentManager, 'steer' | 'abort'>> = {},
): SubagentManager {
  return {
    get: () => undefined,
    steer: async () => true,
    abort: async () => true,
    ...overrides,
  } as unknown as SubagentManager
}

function makeViewer(
  subagent = makeSubagent(),
  manager = makeManager(),
  done: (result: undefined) => void = () => {},
  notify: (message: string, level: 'info' | 'warning') => void = () => {},
) {
  return new SubagentViewer(
    makeTui(),
    makeTheme(),
    subagent,
    manager,
    done,
    notify,
  )
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

  it('submits the steer message via enter in edit mode', async () => {
    const steer = vi.fn(async () => true)
    const notify = vi.fn()
    const component = makeViewer(
      makeSubagent(),
      makeManager({ steer }),
      () => {},
      notify,
    )
    component.handleInput(ENTER)
    component.handleInput('hello world')
    component.handleInput(ENTER)
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledWith(3, 'hello world')
    })
    expect(notify).toHaveBeenCalledWith('Steered subagent #3.', 'info')
  })

  it('returns to view mode on escape without steering', () => {
    const steer = vi.fn(async () => true)
    const component = makeViewer(makeSubagent(), makeManager({ steer }))
    component.handleInput(ENTER)
    component.handleInput(ESC)
    const lines = component.render(120).join('\n')
    expect(lines).toContain('enter steer')
    expect(lines).not.toContain('shift+enter')
    expect(steer).not.toHaveBeenCalled()
  })

  it('ignores whitespace-only input and returns to view mode', () => {
    const steer = vi.fn(async () => true)
    const component = makeViewer(makeSubagent(), makeManager({ steer }))
    component.handleInput(ENTER)
    component.handleInput('   ')
    component.handleInput(ENTER)
    expect(steer).not.toHaveBeenCalled()
    expect(component.render(120).join('\n')).toContain('enter steer')
  })

  it('does not enter edit mode when the subagent is not running', () => {
    const component = makeViewer(makeSubagent({ status: 'killed' }))
    component.handleInput(ENTER)
    expect(component.render(120).join('\n')).not.toContain('shift+enter')
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

  it('notifies warning when steer fails and stays open', async () => {
    const steer = vi.fn(async () => false)
    const notify = vi.fn()
    let done = false
    const component = makeViewer(
      makeSubagent(),
      makeManager({ steer }),
      () => {
        done = true
      },
      notify,
    )
    component.handleInput(ENTER)
    component.handleInput('ping')
    component.handleInput(ENTER)
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        'Subagent #3 is no longer running.',
        'warning',
      )
    })
    expect(done).toBe(false)
    expect(component.render(120).join('\n')).toContain('enter steer')
  })

  it('scrolls history with pgdn in edit mode', () => {
    const message = Array.from({ length: 60 }, (_, i) => `line${i}`).join('\n')
    const component = makeViewer(
      makeSubagent({
        session: {
          messages: [
            {
              role: 'user',
              content: message,
              timestamp: Date.now(),
            },
          ],
          subscribe: () => () => {},
        } as unknown as AgentSession,
      }),
    )
    const before = component.render(120).join('\n')
    component.handleInput(ENTER)
    component.handleInput(PAGE_DOWN)
    expect(component.render(120).join('\n')).not.toBe(before)
  })

  it('shrinks the scroll viewport in edit mode', () => {
    const message = Array.from({ length: 60 }, (_, i) => `line${i}`).join('\n')
    const component = makeViewer(
      makeSubagent({
        session: {
          messages: [
            {
              role: 'user',
              content: message,
              timestamp: Date.now(),
            },
          ],
          subscribe: () => () => {},
        } as unknown as AgentSession,
      }),
    )
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
    await openSubagentViewer(ctx, manager, 99)
    expect(notify).toHaveBeenCalledWith('Subagent #99 not found.', 'warning')
    expect(custom).not.toHaveBeenCalled()
  })
})
