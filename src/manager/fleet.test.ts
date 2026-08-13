import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { Editor } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'

import { formatElapsed } from '../helper.js'
import { type FleetEntry, FleetList } from './fleet.js'

describe('formatElapsed', () => {
  const base = (
    overrides: Partial<FleetEntry> & { title?: never },
  ): FleetEntry => ({
    id: 1,
    title: '',
    startedAt: 1000,
    status: 'running',
    ...overrides,
  })

  it('rounds down to whole seconds', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 12_400 }))).toBe(
      '12s',
    )
  })

  it('uses now when the worker is still running', () => {
    const now = Date.now()
    const worker = base({ startedAt: now - 4_000 })
    expect(formatElapsed(worker)).toBe('4s')
  })

  it('never goes negative', () => {
    expect(formatElapsed(base({ startedAt: 5_000, completedAt: 1_000 }))).toBe(
      '0s',
    )
  })

  it('shows minutes for >= 60s', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 5 * 60_000 }))).toBe(
      '5m 0s',
    )
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 10 * 60_000 })),
    ).toBe('10m 0s')
  })

  it('shows hours for >= 60min', () => {
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 2 * 60 * 60_000 })),
    ).toBe('2h 0m 0s')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 24 * 60 * 60_000 })),
    ).toBe('24h 0m 0s')
  })

  it('handles boundary values', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 59_999 }))).toBe(
      '59s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 60_000 }))).toBe(
      '1m 0s',
    )
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 59 * 60_000 })),
    ).toBe('59m 0s')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 60 * 60_000 })),
    ).toBe('1h 0m 0s')
  })

  it('rounds down minutes', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 89_999 }))).toBe(
      '1m 29s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 119_999 }))).toBe(
      '1m 59s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 120_000 }))).toBe(
      '2m 0s',
    )
  })

  it('shows remainder seconds when >= 1 minute', () => {
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 5 * 60_000 + 30_000 })),
    ).toBe('5m 30s')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 1 * 60_000 + 59_999 })),
    ).toBe('1m 59s')
  })

  it('shows remainder minutes and seconds when >= 1 hour', () => {
    expect(
      formatElapsed(
        base({
          startedAt: 0,
          completedAt: 2 * 60 * 60_000 + 5 * 60_000 + 30_000,
        }),
      ),
    ).toBe('2h 5m 30s')
    expect(
      formatElapsed(
        base({
          startedAt: 0,
          completedAt: 1 * 60 * 60_000 + 30 * 60_000 + 45_000,
        }),
      ),
    ).toBe('1h 30m 45s')
  })
})

describe('FleetList focus gate (#123)', () => {
  type FakeTui = {
    requestRender: () => void
    hasOverlay: () => boolean
    focusedComponent?: unknown
  }

  let fakeTui: FakeTui
  let capturedOnTerminalInput:
    ((data: string) => { consume?: boolean } | undefined) | undefined
  let capturedSetWidget: (
    key: string,
    factory: ((tui: unknown) => unknown) | undefined,
    options?: unknown,
  ) => void

  function createFakeTheme() {
    return {
      fg: (_variant: string, text: string) => text,
      strikethrough: (text: string) => text,
      borderColor: (str: string) => str,
      selectList: {
        selectedPrefix: (text: string) => text,
        selectedText: (text: string) => text,
        description: (text: string) => text,
        scrollInfo: (text: string) => text,
        noMatch: (text: string) => text,
      },
    }
  }

  function createFakeContext(): Record<string, unknown> {
    const fakeContext = {
      ui: {
        getEditorText: () => '',
        setWidget: (
          key: string,
          factory: ((tui: unknown) => unknown) | undefined,
          options?: unknown,
        ) => {
          capturedSetWidget(key, factory, options)
        },
        theme: createFakeTheme(),
        onTerminalInput: (
          handler: (data: string) => { consume?: boolean } | undefined,
        ) => {
          capturedOnTerminalInput = handler
          return () => {
            capturedOnTerminalInput = undefined
          }
        },
        notify: () => {},
      },
    }
    return fakeContext
  }

  function createFakeTui(): FakeTui {
    return {
      requestRender: () => {},
      hasOverlay: () => false,
      focusedComponent: null,
    }
  }

  let entries: FleetEntry[]
  let fleetList: FleetList

  function createHarness() {
    fakeTui = createFakeTui()
    capturedOnTerminalInput = undefined
    capturedSetWidget = () => {}

    const now = Date.now()
    entries = [
      {
        id: 1,
        title: 'test task',
        status: 'running',
        startedAt: now,
      },
    ]

    fleetList = new FleetList({
      list: () => entries,
      onOpen: () => {},
    })

    capturedSetWidget = (
      key: string,
      factory: ((tui: unknown) => unknown) | undefined,
    ) => {
      if (factory) {
        const result = factory(fakeTui)
        Object.assign(fakeTui, result)
      }
    }

    const fakeContext = createFakeContext()
    fleetList.setContext(fakeContext as unknown as ExtensionContext)
  }

  function press(key: string): { consume?: boolean } | undefined {
    if (!capturedOnTerminalInput) {
      throw new Error('onTerminalInput handler not captured')
    }
    return capturedOnTerminalInput(key)
  }

  const DOWN = '\x1b[B'

  function setFocus(comp: unknown) {
    fakeTui.focusedComponent = comp
  }

  it('does not consume key when focused component is non-editor', () => {
    createHarness()
    setFocus({ kind: 'selector' })
    const result = press(DOWN)
    expect(result).toBeUndefined()
  })

  it('consumes key when focused component is editor', () => {
    createHarness()
    const editor = new Editor(fakeTui as unknown as TUI, createFakeTheme())
    setFocus(editor)
    const result = press(DOWN)
    expect(result).toEqual({ consume: true })
  })

  it('deactivates when non-editor component receives focus while active', () => {
    createHarness()
    const editor = new Editor(fakeTui as unknown as TUI, createFakeTheme())
    setFocus(editor)
    const firstResult = press(DOWN)
    expect(firstResult).toEqual({ consume: true })

    setFocus({ kind: 'selector' })
    const secondResult = press(DOWN)
    expect(secondResult).toBeUndefined()
  })

  it('consumes key when tui has not yet rendered (focusedComponent is null)', () => {
    createHarness()
    setFocus(null)
    const result = press(DOWN)
    expect(result).toEqual({ consume: true })
  })
})
