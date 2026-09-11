import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { Editor } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'

import { formatElapsed } from '../utils/format.js'
import { type FleetEntry, FleetList, type FleetListOptions } from './fleet.js'

function createFakeTheme() {
  return {
    fg: (variant: string, text: string) => `[FG:${variant}]${text}[/-FG]`,
    bg: (variant: string, text: string) => `[BG:${variant}]${text}[/-BG]`,
    bold: (text: string) => `[BOLD]${text}[/BOLD]`,
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

describe('FleetList roster sorting', () => {
  const now = Date.now()

  function createFleetList(entries: FleetEntry[]) {
    return new FleetList({
      list: () => entries,
      onOpen: () => {},
    })
  }

  it('sorts running items first by id descending, then done items by id descending', () => {
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'done',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 5,
        title: 'task 5',
        previousEntries: [],
        status: 'done',
        startedAt: now - 20000,
        completedAt: now - 15000,
        followUpCount: 1,
        role: 'worker',
      },
      {
        id: 3,
        title: 'task 3',
        previousEntries: [],
        status: 'running',
        startedAt: now - 3000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 4,
        title: 'task 4',
        previousEntries: [],
        status: 'running',
        startedAt: now - 4000,
        followUpCount: 2,
        role: 'supervisor',
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'done',
        startedAt: now - 8000,
        completedAt: now - 6000,
        followUpCount: 0,
        role: 'worker',
      },
    ]

    const fleetList = createFleetList(entries)

    const roster = fleetList['roster']()

    const itemEntries = roster.filter((entry) => entry.kind === 'item')

    expect(itemEntries.map((e) => e.item.id)).toEqual([4, 3, 5, 2, 1])

    expect(itemEntries.map((e) => e.item.status)).toEqual([
      'running',
      'running',
      'done',
      'done',
      'done',
    ])
  })

  it('handles all running items', () => {
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'running',
        startedAt: now - 1000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 3,
        title: 'task 3',
        previousEntries: [],
        status: 'running',
        startedAt: now - 3000,
        followUpCount: 1,
        role: 'supervisor',
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'running',
        startedAt: now - 2000,
        followUpCount: 0,
        role: 'worker',
      },
    ]

    const fleetList = createFleetList(entries)
    const roster = fleetList['roster']()
    const itemEntries = roster.filter((entry) => entry.kind === 'item')

    expect(itemEntries.map((e) => e.item.id)).toEqual([3, 2, 1])
  })

  it('handles all done items', () => {
    const entries: FleetEntry[] = [
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'done',
        startedAt: now - 2000,
        completedAt: now - 1000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 5,
        title: 'task 5',
        previousEntries: [],
        status: 'done',
        startedAt: now - 5000,
        completedAt: now - 4000,
        followUpCount: 1,
        role: 'worker',
      },
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'done',
        startedAt: now - 1000,
        completedAt: now - 500,
        followUpCount: 0,
        role: 'supervisor',
      },
    ]

    const fleetList = createFleetList(entries)
    const roster = fleetList['roster']()
    const itemEntries = roster.filter((entry) => entry.kind === 'item')

    expect(itemEntries.map((e) => e.item.id)).toEqual([5, 2, 1])
  })

  it('handles mixed statuses including failed and killed', () => {
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'failed',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 4,
        title: 'task 4',
        previousEntries: [],
        status: 'running',
        startedAt: now - 2000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'killed',
        startedAt: now - 8000,
        completedAt: now - 7000,
        followUpCount: 1,
        role: 'worker',
      },
      {
        id: 3,
        title: 'task 3',
        previousEntries: [],
        status: 'running',
        startedAt: now - 3000,
        followUpCount: 0,
        role: 'supervisor',
      },
    ]

    const fleetList = createFleetList(entries)
    const roster = fleetList['roster']()
    const itemEntries = roster.filter((entry) => entry.kind === 'item')

    expect(itemEntries.map((e) => e.item.id)).toEqual([4, 3, 2, 1])

    expect(itemEntries.map((e) => e.item.status)).toEqual([
      'running',
      'running',
      'killed',
      'failed',
    ])
  })
})

describe('formatElapsed', () => {
  const base = (
    overrides: Partial<FleetEntry> & { title?: never },
  ): FleetEntry => ({
    id: 1,
    title: '',
    previousEntries: [],
    startedAt: 1000,
    status: 'running',
    followUpCount: 0,
    role: 'worker',
    ...overrides,
  })

  it('rounds down to whole seconds', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 12_400 }))).toBe(
      '12s',
    )
  })

  it('uses now when the subagent is still running', () => {
    const now = Date.now()
    const subagent = base({ startedAt: now - 4_000 })
    expect(formatElapsed(subagent)).toBe('4s')
  })

  it('never goes negative', () => {
    expect(formatElapsed(base({ startedAt: 5_000, completedAt: 1_000 }))).toBe(
      '0s',
    )
  })

  it('shows minutes for >= 60s', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 5 * 60_000 }))).toBe(
      '5m0s',
    )
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 10 * 60_000 })),
    ).toBe('10m0s')
  })

  it('shows hours for >= 60min', () => {
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 2 * 60 * 60_000 })),
    ).toBe('2h0m0s')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 24 * 60 * 60_000 })),
    ).toBe('24h0m0s')
  })

  it('handles boundary values', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 59_999 }))).toBe(
      '59s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 60_000 }))).toBe(
      '1m0s',
    )
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 59 * 60_000 })),
    ).toBe('59m0s')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 60 * 60_000 })),
    ).toBe('1h0m0s')
  })

  it('rounds down minutes', () => {
    expect(formatElapsed(base({ startedAt: 0, completedAt: 89_999 }))).toBe(
      '1m29s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 119_999 }))).toBe(
      '1m59s',
    )
    expect(formatElapsed(base({ startedAt: 0, completedAt: 120_000 }))).toBe(
      '2m0s',
    )
  })

  it('shows remainder seconds when >= 1 minute', () => {
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 5 * 60_000 + 30_000 })),
    ).toBe('5m30s')
    expect(
      formatElapsed(base({ startedAt: 0, completedAt: 1 * 60_000 + 59_999 })),
    ).toBe('1m59s')
  })

  it('shows remainder minutes and seconds when >= 1 hour', () => {
    expect(
      formatElapsed(
        base({
          startedAt: 0,
          completedAt: 2 * 60 * 60_000 + 5 * 60_000 + 30_000,
        }),
      ),
    ).toBe('2h5m30s')
    expect(
      formatElapsed(
        base({
          startedAt: 0,
          completedAt: 1 * 60 * 60_000 + 30 * 60_000 + 45_000,
        }),
      ),
    ).toBe('1h30m45s')
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
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
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

describe('FleetList renderBar when inactive', () => {
  function createFakeContext(): Record<string, unknown> {
    return {
      ui: {
        getEditorText: () => '',
        setWidget: () => {},
        theme: createFakeTheme(),
        onTerminalInput: () => () => {},
        notify: () => {},
      },
    }
  }

  it('renders main line without any bullet', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'test task',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
    ]

    const fleetList = new FleetList({
      list: () => entries,
      onOpen: () => {},
    })

    const fakeContext = createFakeContext()
    fleetList.setContext(fakeContext as unknown as ExtensionContext)

    // Simulate inactive state (activeSelect = false)
    fleetList['activeSelect'] = false

    // Get the render output
    const width = 100
    const render = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(width)

    // Check that main line does not contain any bullet
    const mainLine = render.find((line: string) => line.includes('subagents'))
    expect(mainLine).toBeDefined()
    expect(mainLine).not.toContain('●')
    expect(mainLine).not.toContain('◯')
  })

  it('renders status counts and total context usage on the subagents header line', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: { tokens: 50000, contextWindow: 200000, percent: 25 },
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: { tokens: 80000, contextWindow: 200000, percent: 40 },
      },
      {
        id: 3,
        title: 'task 3',
        previousEntries: [],
        status: 'done',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
        contextUsage: { tokens: 30000, contextWindow: 200000, percent: 15 },
      },
    ]

    const fleetList = new FleetList({ list: () => entries, onOpen: () => {} })
    const fakeContext = createFakeContext()
    fleetList.setContext(fakeContext as unknown as ExtensionContext)
    fleetList['activeSelect'] = false

    const render = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(100)

    const mainLine = render.find((line: string) => line.includes('subagents'))
    expect(mainLine).toBeDefined()
    expect(mainLine).toContain('done(1)')
    expect(mainLine).toContain('running(2)')
    expect(mainLine).toContain('160k')
  })

  it('renders done(0) when only running items are present', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: undefined,
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: undefined,
      },
    ]

    const fleetList = new FleetList({ list: () => entries, onOpen: () => {} })
    const fakeContext = createFakeContext()
    fleetList.setContext(fakeContext as unknown as ExtensionContext)
    fleetList['activeSelect'] = false

    const render = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(100)

    const mainLine = render.find((line: string) => line.includes('subagents'))
    expect(mainLine).toBeDefined()
    expect(mainLine).toContain('done(0)')
    expect(mainLine).toContain('running(2)')
    expect(mainLine).toContain('failed(0)')
    expect(mainLine).toContain('killed(0)')
    expect(mainLine).not.toContain('undefined')
  })

  it('omits the token total from the header when no running subagent has context usage', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: undefined,
      },
    ]

    const fleetList = new FleetList({ list: () => entries, onOpen: () => {} })
    const fakeContext = createFakeContext()
    fleetList.setContext(fakeContext as unknown as ExtensionContext)
    fleetList['activeSelect'] = false

    const render = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(100)

    const mainLine = render.find((line: string) => line.includes('subagents'))
    expect(mainLine).toBeDefined()
    expect(mainLine).toContain('done(0)')
    expect(mainLine).toContain('running(1)')
    expect(mainLine).not.toMatch(/\d[km]?$/) // no token total (e.g. "160k")
  })

  it('renders all subagents without selected bullet (●) when inactive', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'done',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 1,
        role: 'supervisor',
      },
    ]

    const fleetList = new FleetList({
      list: () => entries,
      onOpen: () => {},
    })

    const fakeContext = createFakeContext()
    fleetList.setContext(fakeContext as unknown as ExtensionContext)

    // Simulate inactive state (activeSelect = false)
    fleetList['activeSelect'] = false

    // Get the render output
    const width = 100
    const render = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(width)

    // Check that no line contains the selected bullet (●)
    for (const line of render) {
      expect(line).not.toContain('●')
    }
  })

  it('renders first item with selected bullet (●) when active and selectedIndex is 1', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'test task',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
    ]

    const fleetList = new FleetList({
      list: () => entries,
      onOpen: () => {},
    })

    const fakeContext = createFakeContext()
    fleetList.setContext(fakeContext as unknown as ExtensionContext)

    // Simulate active state (activeSelect = true, selectedIndex = 1 for first item)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 1

    // Get the render output
    const width = 200
    const render = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(width)

    // Check that main line has no bullet
    const mainLine = render.find((line: string) => line.includes('subagents'))
    expect(mainLine).toBeDefined()
    expect(mainLine).not.toContain('●')
    expect(mainLine).not.toContain('◯')

    // Check that an item line contains the selected bullet (●)
    const itemLine = render.find((line: string) =>
      line.includes('[BG:selectedBg]'),
    )
    expect(itemLine).toBeDefined()
    expect(itemLine).toContain('●')
  })

  it('renders previousEntries with status-colored titles, status, followUpCount, and elapsed', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'current task',
        previousEntries: [
          {
            title: 'previous 1',
            status: 'done',
            followUpCount: 1,
            startedAt: now - 8000,
            completedAt: now - 5000,
          },
          {
            title: 'previous 2',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 10000,
            completedAt: now - 5000,
          },
        ],
        status: 'done',
        startedAt: now - 5000,
        completedAt: now - 5000,
        followUpCount: 2,
        role: 'worker',
      },
    ]

    const fleetList = new FleetList({
      list: () => entries,
      onOpen: () => {},
    })

    const fakeContext = createFakeContext()
    fleetList.setContext(fakeContext as unknown as ExtensionContext)
    fleetList['activeSelect'] = false

    const width = 200
    const render = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(width)

    expect(render).toContainEqual(expect.stringContaining('↳'))
    expect(render).toContainEqual(expect.stringContaining('previous 1'))
    expect(render).toContainEqual(expect.stringContaining('previous 2'))
    expect(render).not.toContainEqual(
      expect.stringContaining('[FG:syntaxVariable]previous 1'),
    )
    expect(render).not.toContainEqual(
      expect.stringContaining('[FG:syntaxVariable]previous 2'),
    )
    expect(render).toContainEqual(expect.stringContaining('⟳ 1'))
    expect(render).toContainEqual(expect.stringContaining('⟳ 0'))
    expect(render).toContainEqual(expect.stringContaining('done'))
    expect(render).toContainEqual(expect.stringContaining('current task'))
    expect(render).not.toContainEqual(
      expect.stringContaining('[FG:syntaxVariable]current task'),
    )
    expect(render).toContainEqual(
      expect.stringContaining('[FG:muted]      0s[/-FG]'),
    )
    expect(render).not.toContainEqual(
      expect.stringContaining('[FG:dim]      0s[/-FG]'),
    )
    expect(render).not.toContainEqual(
      expect.stringContaining('[BG:selectedBg]'),
    )
  })
})

describe('FleetList renderBar selection highlight', () => {
  function createFakeContext(): Record<string, unknown> {
    return {
      ui: {
        getEditorText: () => '',
        setWidget: () => {},
        theme: createFakeTheme(),
        onTerminalInput: () => () => {},
        notify: () => {},
      },
    }
  }

  function createFleetList(entries: FleetEntry[]): FleetList {
    const fleetList = new FleetList({
      list: () => entries,
      onOpen: () => {},
    })
    fleetList.setContext(createFakeContext() as unknown as ExtensionContext)
    return fleetList
  }

  function render(fleetList: FleetList, width = 200): string[] {
    return (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(width)
  }

  it('does not highlight the main row even when selectedIndex is 0', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 0

    const lines = render(fleetList)

    for (const line of lines) {
      expect(line).not.toContain('[BG:selectedBg]')
    }
  })

  it('highlights only the first item row when selectedIndex is 1', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'current task',
        previousEntries: [
          {
            title: 'previous 1',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 8000,
            completedAt: now - 5000,
          },
          {
            title: 'previous 2',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 10000,
            completedAt: now - 5000,
          },
        ],
        status: 'done',
        startedAt: now - 5000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 1

    const lines = render(fleetList)

    const mainLine = lines.find((line) => line.includes('subagents'))
    expect(mainLine).toBeDefined()
    expect(mainLine).not.toContain('[BG:selectedBg]')

    const itemLine = lines.find((line) => line.includes('current task'))
    expect(itemLine).toBeDefined()
    expect(itemLine).toContain('[BG:selectedBg]')

    const prev1Line = lines.find((line) => line.includes('previous 1'))
    expect(prev1Line).toBeDefined()
    expect(prev1Line).not.toContain('[BG:selectedBg]')

    const prev2Line = lines.find((line) => line.includes('previous 2'))
    expect(prev2Line).toBeDefined()
    expect(prev2Line).not.toContain('[BG:selectedBg]')
  })

  it('highlights only the middle item row when selectedIndex is 2', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 3,
        title: 'task 3',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 2

    const lines = render(fleetList)

    const mainLine = lines.find((line) => line.includes('subagents'))
    expect(mainLine).toBeDefined()
    expect(mainLine).not.toContain('[BG:selectedBg]')

    const task2Line = lines.find((line) => line.includes('task 2'))
    expect(task2Line).toBeDefined()
    expect(task2Line).toContain('[BG:selectedBg]')

    const task1Line = lines.find((line) => line.includes('task 1'))
    expect(task1Line).toBeDefined()
    expect(task1Line).not.toContain('[BG:selectedBg]')

    const task3Line = lines.find((line) => line.includes('task 3'))
    expect(task3Line).toBeDefined()
    expect(task3Line).not.toContain('[BG:selectedBg]')
  })

  it('highlights no row when selection is inactive', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [
          {
            title: 'previous 1',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 8000,
            completedAt: now - 5000,
          },
        ],
        status: 'done',
        startedAt: now - 5000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = false

    const lines = render(fleetList)

    for (const line of lines) {
      expect(line).not.toContain('[BG:selectedBg]')
    }
  })

  it('keeps title styling on the selected row', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 2,
        title: 'task two',
        previousEntries: [],
        status: 'done',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 1,
        title: 'task one',
        previousEntries: [],
        status: 'done',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 1

    const lines = render(fleetList)

    const selectedLine = lines.find((line) => line.includes('task two'))
    expect(selectedLine).toBeDefined()
    expect(selectedLine).toContain('[BG:selectedBg]')
    expect(selectedLine).toContain('task two')
    expect(selectedLine).not.toContain('[FG:syntaxVariable]task two')
    expect(selectedLine).not.toContain('[FG:dim]task two')

    const unselectedLine = lines.find((line) => line.includes('task one'))
    expect(unselectedLine).toBeDefined()
    expect(unselectedLine).not.toContain('[BG:selectedBg]')
    expect(unselectedLine).toContain('task one')
    expect(unselectedLine).not.toContain('[FG:syntaxVariable]task one')
  })

  it('renders failed and killed titles with error', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'failed task',
        previousEntries: [],
        status: 'failed',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 2,
        title: 'killed task',
        previousEntries: [],
        status: 'killed',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = false

    const lines = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(200)

    expect(lines).toContainEqual(
      expect.stringContaining('[FG:error]failed task[/-FG]'),
    )
    expect(lines).toContainEqual(
      expect.stringContaining('[FG:error]killed task[/-FG]'),
    )
  })

  it('uses muted (not dim) for elapsedCol on the selected row', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 2,
        title: 'task two',
        previousEntries: [],
        status: 'running',
        startedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 1,
        title: 'task one',
        previousEntries: [],
        status: 'running',
        startedAt: now - 3000,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 1

    const lines = render(fleetList)

    const selectedLine = lines.find((line) => line.includes('task two'))
    expect(selectedLine).toBeDefined()
    expect(selectedLine).toContain('[BG:selectedBg]')
    expect(selectedLine).toContain('[BOLD]task two[/BOLD]')
    expect(selectedLine).toContain('[FG:muted]')
    expect(selectedLine).not.toContain('[FG:dim]      5s[/-FG]')

    const unselectedLine = lines.find((line) => line.includes('task one'))
    expect(unselectedLine).toBeDefined()
    expect(unselectedLine).not.toContain('[BG:selectedBg]')
    expect(unselectedLine).toContain('[BOLD]task one[/BOLD]')
    expect(unselectedLine).toContain('[FG:muted]      3s[/-FG]')
  })
})

describe('FleetList row-based selection navigation', () => {
  function createFakeContext(): Record<string, unknown> {
    return {
      ui: {
        getEditorText: () => '',
        setWidget: () => {},
        theme: createFakeTheme(),
        onTerminalInput: () => () => {},
        notify: () => {},
      },
    }
  }

  function createFleetList(entries: FleetEntry[]): FleetList {
    const fleetList = new FleetList({
      list: () => entries,
      onOpen: () => {},
    })
    fleetList.setContext(createFakeContext() as unknown as ExtensionContext)
    return fleetList
  }

  it('can navigate into previous rows with down arrow', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'current task',
        previousEntries: [
          {
            title: 'previous 1',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 8000,
            completedAt: now - 5000,
          },
          {
            title: 'previous 2',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 10000,
            completedAt: now - 5000,
          },
        ],
        status: 'done',
        startedAt: now - 5000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 1

    const lines1 = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(200)
    const itemLine = lines1.find((line) => line.includes('current task'))
    expect(itemLine).toBeDefined()
    expect(itemLine).toContain('[BG:selectedBg]')

    fleetList['selectedIndex'] = 2
    const lines2 = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(200)
    const prev1Line = lines2.find((line) => line.includes('previous 1'))
    expect(prev1Line).toBeDefined()
    expect(prev1Line).toContain('[BG:selectedBg]')

    fleetList['selectedIndex'] = 3
    const lines3 = (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(200)
    const prev2Line = lines3.find((line) => line.includes('previous 2'))
    expect(prev2Line).toBeDefined()
    expect(prev2Line).toContain('[BG:selectedBg]')
  })

  it('deactivates when up from first item row', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'test task',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 1
    expect(fleetList['activeSelect']).toBe(true)
    expect(fleetList['selectedIndex']).toBe(1)

    fleetList['selectedIndex'] = 0
    fleetList['activeSelect'] = false

    expect(fleetList['activeSelect']).toBe(false)
    expect(fleetList['selectedIndex']).toBe(0)
  })

  it('opens parent item id when ENTER pressed on previous row', async () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'current task',
        previousEntries: [
          {
            title: 'previous 1',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 8000,
            completedAt: now - 5000,
          },
        ],
        status: 'done',
        startedAt: now - 5000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
    ]

    let openedId: number | undefined
    const fleetList = createFleetList(entries)
    ;(fleetList as unknown as { options: FleetListOptions }).options.onOpen = (
      _ctx: unknown,
      id: number,
    ) => {
      openedId = id
    }
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 2

    await (
      fleetList as unknown as {
        openSelected: () => Promise<void>
      }
    ).openSelected()

    expect(openedId).toBe(1)
  })

  it('highlights only one row at a time', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [
          {
            title: 'previous 1',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 8000,
            completedAt: now - 5000,
          },
          {
            title: 'previous 2',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 10000,
            completedAt: now - 5000,
          },
        ],
        status: 'done',
        startedAt: now - 5000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true

    const indices = [1, 2, 3, 4]
    for (const idx of indices) {
      fleetList['selectedIndex'] = idx
      const lines = (
        fleetList as unknown as { renderBar: (w: number) => string[] }
      ).renderBar(200)

      const highlightedLines = lines.filter((line) =>
        line.includes('[BG:selectedBg]'),
      )
      expect(highlightedLines).toHaveLength(1)
    }
  })
})

describe('FleetList renderBar uses sorted roster order', () => {
  function createFakeContext(): Record<string, unknown> {
    return {
      ui: {
        getEditorText: () => '',
        setWidget: () => {},
        theme: createFakeTheme(),
        onTerminalInput: () => () => {},
        notify: () => {},
      },
    }
  }

  function createFleetList(entries: FleetEntry[]): FleetList {
    const fleetList = new FleetList({
      list: () => entries,
      onOpen: () => {},
    })
    fleetList.setContext(createFakeContext() as unknown as ExtensionContext)
    return fleetList
  }

  function render(fleetList: FleetList, width = 200): string[] {
    return (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(width)
  }

  function done(
    id: number,
    previousEntries: FleetEntry['previousEntries'] = [],
  ): FleetEntry {
    const now = Date.now()
    return {
      id,
      title: `task ${id}`,
      previousEntries,
      status: 'done',
      startedAt: now - id * 10000,
      completedAt: now - id * 10000 + 5000,
      followUpCount: 0,
      role: 'worker',
    }
  }

  it('display order matches sorted roster order for done items', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'done',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'done',
        startedAt: now - 20000,
        completedAt: now - 15000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 3,
        title: 'task 3',
        previousEntries: [],
        status: 'done',
        startedAt: now - 30000,
        completedAt: now - 25000,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = false

    const lines = render(fleetList)
    const task1Index = lines.findIndex((line) => line.includes('task 1'))
    const task2Index = lines.findIndex((line) => line.includes('task 2'))
    const task3Index = lines.findIndex((line) => line.includes('task 3'))

    expect(task3Index).toBeGreaterThan(-1)
    expect(task2Index).toBeGreaterThan(-1)
    expect(task1Index).toBeGreaterThan(-1)

    expect(task3Index).toBeLessThan(task2Index)
    expect(task2Index).toBeLessThan(task1Index)
  })

  it('cursor moves to adjacent lines when pressing down', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [],
        status: 'done',
        startedAt: now - 10000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'done',
        startedAt: now - 20000,
        completedAt: now - 15000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 3,
        title: 'task 3',
        previousEntries: [],
        status: 'done',
        startedAt: now - 30000,
        completedAt: now - 25000,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 1

    const lines1 = render(fleetList)
    const highlightedLines1 = lines1.filter((line) =>
      line.includes('[BG:selectedBg]'),
    )
    expect(highlightedLines1).toHaveLength(1)
    expect(highlightedLines1[0]).toContain('task 3')

    fleetList['selectedIndex'] = 2
    const lines2 = render(fleetList)
    const highlightedLines2 = lines2.filter((line) =>
      line.includes('[BG:selectedBg]'),
    )
    expect(highlightedLines2).toHaveLength(1)
    expect(highlightedLines2[0]).toContain('task 2')

    const task3Idx1 = lines1.findIndex((line) => line.includes('task 3'))
    const task2Idx1 = lines1.findIndex((line) => line.includes('task 2'))
    const task2Idx2 = lines2.findIndex((line) => line.includes('task 2'))

    expect(task2Idx1).toBe(task3Idx1 + 1)
    expect(task2Idx2).toBe(task2Idx1)
  })

  it('cursor moves to adjacent lines including previous rows', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'task 1',
        previousEntries: [
          {
            title: 'previous 1',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 8000,
            completedAt: now - 5000,
          },
          {
            title: 'previous 2',
            status: 'done',
            followUpCount: 0,
            startedAt: now - 10000,
            completedAt: now - 5000,
          },
        ],
        status: 'done',
        startedAt: now - 5000,
        completedAt: now - 5000,
        followUpCount: 0,
        role: 'worker',
      },
      {
        id: 2,
        title: 'task 2',
        previousEntries: [],
        status: 'done',
        startedAt: now - 20000,
        completedAt: now - 15000,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 1

    const lines1 = render(fleetList)
    const highlightedLines1 = lines1.filter((line) =>
      line.includes('[BG:selectedBg]'),
    )
    expect(highlightedLines1).toHaveLength(1)
    expect(highlightedLines1[0]).toContain('task 2')

    const task1Idx = lines1.findIndex((line) => line.includes('task 1'))
    const task2Idx = lines1.findIndex((line) => line.includes('task 2'))
    const prev1Idx = lines1.findIndex((line) => line.includes('previous 1'))
    const prev2Idx = lines1.findIndex((line) => line.includes('previous 2'))

    expect(task1Idx).toBeGreaterThan(-1)
    expect(task2Idx).toBeGreaterThan(-1)
    expect(prev1Idx).toBeGreaterThan(-1)
    expect(prev2Idx).toBeGreaterThan(-1)

    expect(task2Idx).toBeLessThan(task1Idx)
    expect(prev1Idx).toBe(task1Idx + 1)
    expect(prev2Idx).toBe(prev1Idx + 1)

    fleetList['selectedIndex'] = 2
    const lines2 = render(fleetList)
    const highlightedLines2 = lines2.filter((line) =>
      line.includes('[BG:selectedBg]'),
    )
    expect(highlightedLines2).toHaveLength(1)
    expect(highlightedLines2[0]).toContain('task 1')

    fleetList['selectedIndex'] = 3
    const lines3 = render(fleetList)
    const highlightedLines3 = lines3.filter((line) =>
      line.includes('[BG:selectedBg]'),
    )
    expect(highlightedLines3).toHaveLength(1)
    expect(highlightedLines3[0]).toContain('previous 1')

    fleetList['selectedIndex'] = 4
    const lines4 = render(fleetList)
    const highlightedLines4 = lines4.filter((line) =>
      line.includes('[BG:selectedBg]'),
    )
    expect(highlightedLines4).toHaveLength(1)
    expect(highlightedLines4[0]).toContain('previous 2')
  })

  it('scrolls window when selection moves past visible items', () => {
    const now = Date.now()
    const entries: FleetEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      title: `task ${i + 1}`,
      previousEntries: [],
      status: 'done',
      startedAt: now - (i + 1) * 10000,
      completedAt: now - (i + 1) * 10000 + 5000,
      followUpCount: 0,
      role: 'worker',
    }))
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true

    fleetList['selectedIndex'] = 1
    const lines1 = render(fleetList)
    expect(lines1.some((line) => line.match(/↑\s+\d+\s+more/))).toBe(false)
    expect(lines1.some((line) => line.match(/↓\s+2\s+more/))).toBe(true)

    fleetList['selectedIndex'] = 10
    const lines2 = render(fleetList)
    expect(lines2.some((line) => line.match(/↑\s+2\s+more/))).toBe(true)
    expect(lines2.some((line) => line.match(/↓\s+\d+\s+more/))).toBe(false)
  })

  it('scrolls window so the selected row is the last visible row', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      done(1, [
        {
          title: 'previous 1',
          status: 'done',
          followUpCount: 0,
          startedAt: now - 8000,
          completedAt: now - 5000,
        },
        {
          title: 'previous 2',
          status: 'done',
          followUpCount: 0,
          startedAt: now - 10000,
          completedAt: now - 5000,
        },
      ]),
      done(2),
      done(3),
      done(4),
      done(5),
      done(6),
      done(7),
      done(8),
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 10

    const lines = render(fleetList)

    const highlighted = lines.filter((line) => line.includes('[BG:selectedBg]'))
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]).toContain('previous 2')
    expect(lines.some((line) => line.match(/↑\s+2\s+more/))).toBe(true)
    expect(lines.some((line) => line.match(/↓\s+\d+\s+more/))).toBe(false)
    expect(lines.some((line) => line.includes('task 8'))).toBe(false)
    expect(lines.some((line) => line.includes('task 1'))).toBe(true)
  })

  it('counts hidden rows including previous rows when scrolling a mid-list selection', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      done(2, [
        {
          title: 'previous 1',
          status: 'done',
          followUpCount: 0,
          startedAt: now - 8000,
          completedAt: now - 5000,
        },
        {
          title: 'previous 2',
          status: 'done',
          followUpCount: 0,
          startedAt: now - 10000,
          completedAt: now - 5000,
        },
      ]),
      done(1),
      done(3),
      done(4),
      done(5),
      done(6),
      done(7),
      done(8),
      done(9),
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = true
    fleetList['selectedIndex'] = 10

    const lines = render(fleetList)

    const highlighted = lines.filter((line) => line.includes('[BG:selectedBg]'))
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]).toContain('previous 2')
    expect(lines.some((line) => line.match(/↑\s+2\s+more/))).toBe(true)
    expect(lines.some((line) => line.match(/↓\s+1\s+more/))).toBe(true)
    expect(lines.some((line) => line.includes('task 9'))).toBe(false)
    expect(lines.some((line) => line.includes('task 1'))).toBe(false)
    expect(lines.some((line) => line.includes('task 2'))).toBe(true)
    expect(lines.some((line) => line.includes('previous 1'))).toBe(true)
  })
})

describe('FleetList context usage rendering', () => {
  function createFakeContext(): Record<string, unknown> {
    return {
      ui: {
        getEditorText: () => '',
        setWidget: () => {},
        theme: createFakeTheme(),
        onTerminalInput: () => () => {},
        notify: () => {},
      },
    }
  }

  function createFleetList(entries: FleetEntry[]): FleetList {
    const fleetList = new FleetList({
      list: () => entries,
      onOpen: () => {},
    })
    fleetList.setContext(createFakeContext() as unknown as ExtensionContext)
    return fleetList
  }

  function render(fleetList: FleetList, width = 200): string[] {
    return (
      fleetList as unknown as { renderBar: (w: number) => string[] }
    ).renderBar(width)
  }

  it('renders normal context usage with muted color', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'test task',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: { tokens: 60000, contextWindow: 200000, percent: 30.0 },
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = false

    const lines = render(fleetList)
    const itemLine = lines.find((line) => line.includes('test task'))
    expect(itemLine).toBeDefined()
    expect(itemLine).toContain('[FG:muted]')
    expect(itemLine).toContain('60k')
    expect(itemLine).toContain('200k')
  })

  it('renders unknown tokens as ?', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'test task',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: { tokens: null, contextWindow: 200000, percent: null },
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = false

    const lines = render(fleetList)
    const itemLine = lines.find((line) => line.includes('test task'))
    expect(itemLine).toBeDefined()
    expect(itemLine).toContain('[FG:muted]')
    expect(itemLine).toContain('?')
    expect(itemLine).not.toContain('?/')
  })

  it('shows placeholder when contextUsage is undefined', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'test task',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = false

    const lines = render(fleetList)
    const itemLine = lines.find((line) => line.includes('test task'))
    expect(itemLine).toBeDefined()
    expect(itemLine).not.toContain('%/')
    expect(itemLine).not.toContain('?/')
    expect(itemLine).toContain('[FG:muted]')
    expect(itemLine).toContain('            ')
  })

  it('shows placeholder when contextWindow is 0', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'test task',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: { tokens: 1000, contextWindow: 0, percent: 10.0 },
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = false

    const lines = render(fleetList)
    const itemLine = lines.find((line) => line.includes('test task'))
    expect(itemLine).toBeDefined()
    expect(itemLine).not.toContain('%/')
    expect(itemLine).toContain('[FG:muted]')
    expect(itemLine).toContain('            ')
  })

  it('uses error color when context usage > 90%', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'test task',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: { tokens: 190000, contextWindow: 200000, percent: 95.0 },
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = false

    const lines = render(fleetList)
    const itemLine = lines.find((line) => line.includes('test task'))
    expect(itemLine).toBeDefined()
    expect(itemLine).toContain('[FG:error]')
    expect(itemLine).not.toContain('[FG:warning]')
    expect(itemLine).toContain('190k')
    expect(itemLine).toContain('200k')
  })

  it('uses warning color when context usage > 70% and <= 90%', () => {
    const now = Date.now()
    const entries: FleetEntry[] = [
      {
        id: 1,
        title: 'test task',
        previousEntries: [],
        status: 'running',
        startedAt: now,
        followUpCount: 0,
        role: 'worker',
        contextUsage: { tokens: 160000, contextWindow: 200000, percent: 80.0 },
      },
    ]
    const fleetList = createFleetList(entries)
    fleetList['activeSelect'] = false

    const lines = render(fleetList)
    const itemLine = lines.find((line) => line.includes('test task'))
    expect(itemLine).toBeDefined()
    expect(itemLine).toContain('[FG:warning]')
    expect(itemLine).not.toContain('[FG:error]')
    expect(itemLine).toContain('160k')
    expect(itemLine).toContain('200k')
  })
})
