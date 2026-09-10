import type { Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

import {
  capEditorLines,
  createReviewPagerComponent,
  type ReviewPagerResult,
} from './review-pager.js'

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMarkdownTheme: () => ({
    heading: (text: string) => text,
    link: (text: string) => text,
    linkUrl: (text: string) => text,
    code: (text: string) => text,
    codeBlock: (text: string) => text,
    codeBlockBorder: (text: string) => text,
    quote: (text: string) => text,
    quoteBorder: (text: string) => text,
    hr: (text: string) => text,
    listBullet: (text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    strikethrough: (text: string) => text,
    underline: (text: string) => text,
  }),
}))

const ENTER = '\r'
const ESC = '\x1b'
const CTRL_C = '\x03'

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

function makeOptions() {
  return {
    title: 'Plan Review',
    plan: '# The plan\n\nDo the thing.',
    choices: [
      { id: 'send', label: 'Send it' },
      { id: 'update-the-plan', label: 'Update the plan', inlineEditor: true },
      { id: 'discard', label: 'Discard' },
    ],
  }
}

function makeComponent(done: (result: ReviewPagerResult | undefined) => void) {
  return createReviewPagerComponent(makeTui(), makeTheme(), makeOptions(), done)
}

describe('createReviewPagerComponent', () => {
  it('renders the menu with all choices', () => {
    const component = makeComponent(() => {})
    const lines = component.render(60).join('\n')
    expect(lines).toContain('Send it')
    expect(lines).toContain('Update the plan')
    expect(lines).toContain('Discard')
  })

  it('switches to the editor on selecting the inline choice', () => {
    const component = makeComponent(() => {})
    component.handleInput('2')
    const lines = component.render(60).join('\n')
    expect(lines).toContain('Update the plan:')
    expect(lines).toContain('shift+enter')
    // edit mode no longer shows the choices menu
    expect(lines).not.toContain('Send it')
    expect(lines).not.toContain('Discard')
    expect(lines).not.toContain('✎')
  })

  it('keeps a minimum scroll viewport and edit footer in the editor', () => {
    const component = makeComponent(() => {})
    component.handleInput('2')
    const lines = component.render(60)
    // title + at least 4 scroll lines + chrome must fit in the render
    expect(lines.length).toBeGreaterThanOrEqual(10)
    expect(lines.join('\n')).toContain('back to choices')
  })

  it('returns to the menu on escape in the editor', () => {
    const component = makeComponent(() => {})
    component.handleInput('2')
    component.handleInput(ESC)
    const lines = component.render(60).join('\n')
    expect(lines).toContain('Send it')
    expect(lines).not.toContain('shift+enter')
  })

  it('submits the editor text via enter', () => {
    let result: ReviewPagerResult | undefined
    const component = makeComponent((r) => {
      result = r
    })
    component.handleInput('2')
    component.handleInput('revise step 2')
    component.handleInput(ENTER)
    expect(result).toEqual({
      choiceId: 'update-the-plan',
      updatePrompt: 'revise step 2',
    })
  })

  it('cancels via ctrl+c in the editor', () => {
    let result: ReviewPagerResult | undefined | 'pending' = 'pending'
    const component = makeComponent((r) => {
      result = r
    })
    component.handleInput('2')
    component.handleInput(CTRL_C)
    expect(result).toBeUndefined()
  })

  it('keeps non-inline choice behaviour unchanged', () => {
    let result: ReviewPagerResult | undefined
    const component = makeComponent((r) => {
      result = r
    })
    component.handleInput('1')
    expect(result).toEqual({ choiceId: 'send' })
  })

  it('degrades to plain choice selection when no inline choice exists', () => {
    let result: ReviewPagerResult | undefined
    const component = createReviewPagerComponent(
      makeTui(),
      makeTheme(),
      {
        title: 'Plan Review',
        plan: '# The plan',
        choices: [
          { id: 'send', label: 'Send it' },
          { id: 'discard', label: 'Discard' },
        ],
      },
      (r) => {
        result = r
      },
    )
    component.handleInput('2')
    expect(result).toEqual({ choiceId: 'discard' })
    // Still in menu mode: no editor chrome rendered
    expect(component.render(60).join('\n')).not.toContain('shift+enter')
  })
})

describe('capEditorLines', () => {
  const TOP = '╭─'
  const BOTTOM = '╰─'
  const hidden = (n: number) => `… +${n} hidden`
  // Window = 4 before + cursor + 3 after + 2 borders.
  const MAX = 10
  const content = (n: number, cursorAt: number) =>
    Array.from({ length: n }, (_, i) =>
      i === cursorAt ? `line${i}\x1b[7m` : `line${i}`,
    )

  it('returns short output untouched', () => {
    const lines = [TOP, 'a', 'b', BOTTOM]
    expect(capEditorLines(lines, hidden)).toBe(lines)
  })

  it('keeps top/bottom borders when truncating', () => {
    const out = capEditorLines([TOP, ...content(20, 10), BOTTOM], hidden)
    expect(out).toHaveLength(MAX)
    expect(out[0]).toBe(TOP)
    expect(out[out.length - 1]).toBe(BOTTOM)
  })

  it('slides a 4/cursor/3 window around a mid cursor', () => {
    const out = capEditorLines([TOP, ...content(20, 8), BOTTOM], hidden)
    // Content window: lines 4..11 (cursor at 8); hidden markers replace the edge lines
    expect(out.slice(1, -1)).toEqual([
      hidden(4),
      'line5',
      'line6',
      'line7',
      'line8\x1b[7m',
      'line9',
      'line10',
      hidden(8),
    ])
  })

  it('clamps the window at the top edge', () => {
    const out = capEditorLines([TOP, ...content(20, 1), BOTTOM], hidden)
    expect(out[1]).toBe('line0')
    expect(out[2]).toBe('line1\x1b[7m')
    // Window hugs the top; only the bottom hides lines
    expect(out.slice(1, -1)).toEqual([
      'line0',
      'line1\x1b[7m',
      'line2',
      'line3',
      'line4',
      'line5',
      'line6',
      hidden(12),
    ])
  })

  it('clamps the window at the bottom edge and marks hidden lines above', () => {
    const out = capEditorLines([TOP, ...content(20, 18), BOTTOM], hidden)
    expect(out[1]).toBe(hidden(12))
    expect(out[out.length - 2]).toBe('line19')
    expect(out[out.length - 3]).toBe('line18\x1b[7m')
  })

  it('counts hidden lines correctly for a cursor near the top', () => {
    const out = capEditorLines([TOP, ...content(20, 5), BOTTOM], hidden)
    expect(out.slice(1, -1)).toEqual([
      hidden(1),
      'line2',
      'line3',
      'line4',
      'line5\x1b[7m',
      'line6',
      'line7',
      hidden(11),
    ])
  })

  it('falls back to top truncation when no cursor line exists', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`)
    const out = capEditorLines([TOP, ...lines, BOTTOM], hidden)
    expect(out).toHaveLength(MAX)
    expect(out[1]).toBe('line0')
    expect(out[out.length - 2]).toBe(hidden(13))
  })

  it('shows 7 real lines before the cursor when it sits on the last content line', () => {
    const out = capEditorLines([TOP, ...content(20, 19), BOTTOM], hidden)
    expect(out[1]).toBe(hidden(12))
    expect(out[out.length - 2]).toBe('line19\x1b[7m')
    // Bottom-clamped window: top hidden marker, nothing hidden below
    expect(out.slice(2, -2)).toEqual([
      'line13',
      'line14',
      'line15',
      'line16',
      'line17',
      'line18',
    ])
    expect(out[out.length - 1]).toBe(BOTTOM)
  })
})
