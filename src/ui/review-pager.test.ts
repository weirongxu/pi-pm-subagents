import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vitest'

import {
  askHowToProceed,
  createReviewPagerComponent,
  type ReviewPagerOptions,
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
const PAGE_UP = '\x1b[5~'
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

  it('p does not move above the first choice', () => {
    let result: ReviewPagerResult | undefined
    const component = makeComponent((r) => {
      result = r
    })
    component.handleInput('p')
    component.handleInput(ENTER)
    expect(result).toEqual({ choiceId: 'send' })
  })

  it('n moves down and enters the third choice', () => {
    let result: ReviewPagerResult | undefined
    const component = makeComponent((r) => {
      result = r
    })
    component.handleInput('n')
    component.handleInput('n')
    component.handleInput(ENTER)
    expect(result).toEqual({ choiceId: 'discard' })
  })

  it('n n p enters the second choice', () => {
    let result: ReviewPagerResult | undefined
    const component = makeComponent((r) => {
      result = r
    })
    component.handleInput('n')
    component.handleInput('n')
    component.handleInput('p')
    // Second choice is the inline editor: enter switches to edit mode
    component.handleInput(ENTER)
    const lines = component.render(60).join('\n')
    expect(lines).toContain('Update the plan:')
    expect(result).toBeUndefined()
  })

  it('scrolls the plan with pgup/pgdn in the editor', () => {
    const plan = Array.from({ length: 60 }, (_, i) => `line${i}`).join('\n\n')
    const component = createReviewPagerComponent(
      makeTui(),
      makeTheme(),
      { ...makeOptions(), plan },
      () => {},
    )
    component.handleInput('2')
    const before = component.render(60).join('\n')
    component.handleInput(PAGE_DOWN)
    const scrolled = component.render(60).join('\n')
    expect(scrolled).not.toBe(before)
    component.handleInput(PAGE_UP)
    expect(component.render(60).join('\n')).toBe(before)
  })

  it('keeps pgdn/pgup hint in the edit footer', () => {
    const component = makeComponent(() => {})
    component.handleInput('2')
    const lines = component.render(120).join('\n')
    expect(lines).toContain('PgUp/PgDn')
    expect(lines).toContain('plan ½page')
  })

  it('sends letters and space to the editor instead of scrolling', () => {
    let result: ReviewPagerResult | undefined
    const component = makeComponent((r) => {
      result = r
    })
    component.handleInput('2')
    component.handleInput('u')
    component.handleInput('d')
    component.handleInput(' ')
    component.handleInput('x')
    component.handleInput(ENTER)
    expect(result).toEqual({
      choiceId: 'update-the-plan',
      updatePrompt: 'ud x',
    })
  })

  it('renders n/p in the footer select hint', () => {
    const component = makeComponent(() => {})
    expect(component.render(120).join('\n')).toContain('↑↓/n/p')
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

describe('askHowToProceed', () => {
  it('emits a notify event before opening the pager', async () => {
    const emit = vi.fn()
    const setWorkingVisible = vi.fn()
    const options: ReviewPagerOptions = {
      ...makeOptions(),
      choices: [{ id: 'send', label: 'Send it' }],
    }
    const ctx = {
      ui: {
        setWorkingVisible,
        custom: () => Promise.resolve<ReviewPagerResult>({ choiceId: 'send' }),
      },
    } as unknown as ExtensionContext
    await askHowToProceed(
      { events: { emit } } as unknown as ExtensionAPI,
      ctx,
      options,
    )
    expect(emit).toHaveBeenCalledWith('pi-notify:notify', options.title)
    expect(setWorkingVisible).toHaveBeenCalledTimes(2)
  })
})
