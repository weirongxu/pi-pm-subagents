import {
  type Component,
  Container,
  Markdown,
  type TuiMouseEvent,
} from '@earendil-works/pi-tui'
import {
  type ExtensionAPI,
  type MessageRenderer,
  type Theme,
  initTheme,
} from '@earendil-works/pi-coding-agent'
import {
  type RendererMessage,
  setupMessageRenderer,
} from './subagent-message-renderer.js'
import { describe, expect, it } from 'vitest'
import { MESSAGE_KEY } from '../utils/messages.js'

const theme = {
  fg: (_color: unknown, text: string) => text,
  bg: (_color: unknown, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme

const makeMessage = (
  content: string,
  display = true,
  details?: Record<string, unknown>,
): RendererMessage => ({
  role: 'custom',
  customType: MESSAGE_KEY,
  content,
  display,
  details,
  timestamp: Date.now(),
})

initTheme()

let renderer: MessageRenderer | undefined
setupMessageRenderer({
  registerMessageRenderer: (_customType: string, fn: MessageRenderer) => {
    renderer = fn
  },
} as ExtensionAPI)

const renderSubagentMessage = (
  message: RendererMessage,
  options: { expanded: boolean; outputPad: number },
  themeArg?: Theme,
): Component | undefined => renderer?.(message, options, themeArg ?? theme)

const renderCollapsedComponent = (message: RendererMessage): Component =>
  renderSubagentMessage(message, { expanded: false, outputPad: 0 }) as Component

const clickEvent = (): TuiMouseEvent => ({
  type: 'click',
  button: 'left',
  x: 0,
  y: 0,
  screenX: 0,
  screenY: 0,
  width: 120,
  height: 1,
  shift: false,
  alt: false,
  ctrl: false,
})

describe('new-format messages (structured details)', () => {
  const doneDetails = {
    kind: 'done',
    jobs: ['done #1 write plan 30% ctx 5m'],
  }

  it('renders single-job collapsed title from details', () => {
    const lines = renderCollapsedComponent(
      makeMessage(
        '**[done #1]** write plan\n\nAll finished.',
        true,
        doneDetails,
      ),
    ).render(120)
    expect(lines.join('\n')).toContain('✓ done #1 write plan 30% ctx 5m')
    expect(lines.join('\n')).toContain('All finished.')
  })

  it('renders multi-job collapsed title with (+N) suffix', () => {
    const details = {
      kind: 'done',
      jobs: ['done #1 first', 'done #2 second', 'done #3 third'],
    }
    const rendered = renderCollapsedComponent(
      makeMessage(
        '**[done #1]** first\n\n---\n\n**[done #2]** second',
        true,
        details,
      ),
    )
      .render(200)
      .join('\n')
    expect(rendered).toContain('✓ done #1 first (+2)')
  })

  it('renders activity title with the activity suffix', () => {
    const rendered = renderCollapsedComponent(
      makeMessage('**[running #3]** research\n\nChecked 5 endpoints', true, {
        kind: 'activity',
        jobs: ['running #3 research'],
      }),
    )
      .render(200)
      .join('\n')
    expect(rendered).toContain('↳ running #3 research · activity')
  })

  it('renders reviewed title with the reviewed suffix', () => {
    const rendered = renderCollapsedComponent(
      makeMessage('**[done #1]** plan\n\nApproved', true, {
        kind: 'reviewed',
        jobs: ['done #1 plan'],
      }),
    )
      .render(200)
      .join('\n')
    expect(rendered).toContain('✓ done #1 plan · reviewed')
  })

  it('previews only the first merged block', () => {
    const rendered = renderCollapsedComponent(
      makeMessage(
        '**[done #1]** first\n\nFirst body\n\n---\n\n**[done #2]** second\n\nSecond body',
        true,
        { kind: 'done', jobs: ['done #1 first', 'done #2 second'] },
      ),
    )
      .render(400)
      .join('\n')
    expect(rendered).toContain('First body')
    expect(rendered).not.toContain('Second body')
  })

  it('renders expanded view with content as-is (no unescaping)', () => {
    const content = '**[done #1]** task\n\n`<config>` & **bold**'
    const component = renderSubagentMessage(
      makeMessage(content, true, doneDetails),
      { expanded: true, outputPad: 0 },
      theme,
    ) as Container
    expect(component).toBeInstanceOf(Container)
    const rendered = component.render(200).join('\n')
    // Rendered Markdown output keeps the raw text (no XML entity escaping).
    expect(rendered).toContain('<config>')
    expect(rendered).toContain('&')
    expect(rendered).not.toContain('&amp;')
    expect(rendered).not.toContain('&lt;')
  })

  it('renders the [pm-subagents] label in expanded view', () => {
    const component = renderSubagentMessage(
      makeMessage('body', true, doneDetails),
      { expanded: true, outputPad: 0 },
      theme,
    ) as Component
    expect(component.render(80).join('\n')).toContain('[pm-subagents]')
  })

  it('renders steer title without a suffix', () => {
    const rendered = renderCollapsedComponent(
      makeMessage('**[steer #1]** x\n\nNew instruction', true, {
        kind: 'steer',
        jobs: ['steer #1 x'],
      }),
    )
      .render(200)
      .join('\n')
    expect(rendered).toContain('↳ steer #1 x')
    expect(rendered).not.toContain('·')
  })

  it('renders the fallback title for empty jobs', () => {
    const rendered = renderCollapsedComponent(
      makeMessage('body', true, { kind: 'done', jobs: [] }),
    )
      .render(120)
      .join('\n')
    expect(rendered).toContain('✓ done')
  })
})

describe('missing or invalid details (no legacy fallback)', () => {
  it('uses the generic title when details are missing', () => {
    const rendered = renderCollapsedComponent(makeMessage('some plain update'))
      .render(120)
      .join('\n')
    expect(rendered).toContain('[pm-subagents]')
    expect(rendered).toContain('some plain update')
  })

  it('uses the generic title when details are invalid', () => {
    const rendered = renderCollapsedComponent(
      makeMessage('plain update\nsecond line', true, {
        kind: 'bogus',
        jobs: 'not-an-array',
      }),
    )
      .render(120)
      .join('\n')
    expect(rendered).toContain('[pm-subagents]')
    expect(rendered).toContain('plain update')
  })

  it('shows raw content verbatim in preview (no unescaping)', () => {
    const rendered = renderCollapsedComponent(
      makeMessage('value is &lt;tag&gt;\n<tag>inline</tag>'),
    )
      .render(200)
      .join('\n')
    expect(rendered).toContain('&lt;tag&gt;')
    expect(rendered).toContain('<tag>inline</tag>')
  })
})

describe('shared rendering behavior', () => {
  const details = { kind: 'done', jobs: ['done #1 task'] }

  it('returns undefined when display is false', () => {
    expect(
      renderSubagentMessage(
        makeMessage('body', false, details),
        { expanded: false, outputPad: 0 },
        theme,
      ),
    ).toBeUndefined()
  })

  it('renders collapsed title + hint only for empty content', () => {
    const rendered = renderCollapsedComponent(makeMessage(''))
      .render(120)
      .join('\n')
    expect(rendered).toContain('[pm-subagents]')
    expect(rendered).not.toContain('expand')
  })

  it('adds no Markdown child for empty expanded content', () => {
    const box = renderSubagentMessage(
      makeMessage('', true, details),
      { expanded: true, outputPad: 0 },
      theme,
    ) as Container
    expect(box.children).toHaveLength(1)
    expect(box.children[0]).not.toBeInstanceOf(Markdown)
  })

  it('joins text blocks when content is an array of TextContent', () => {
    const message = makeMessage('')
    message.content = [
      { type: 'text', text: 'first block' },
      { type: 'text', text: 'second block' },
    ]
    const rendered = renderCollapsedComponent(message).render(120).join('\n')
    expect(rendered).toContain('[pm-subagents]')
    expect(rendered).toContain('first block')
    expect(rendered).toContain('second block')
  })

  it('truncates long preview lines', () => {
    const longLine = 'x'.repeat(300)
    const rendered = renderCollapsedComponent(
      makeMessage(`**[running #9]** job\n\n${longLine}`, true, {
        kind: 'activity',
        jobs: ['running #9 job'],
      }),
    )
      .render(80)
      .join('\n')
    expect(rendered).toContain('...')
    expect(rendered).toContain('x'.repeat(77))
    expect(rendered).not.toContain('x'.repeat(78))
  })

  it('reflects outputPad in the expanded padding', () => {
    const render = (outputPad: number) => {
      const box = renderSubagentMessage(
        makeMessage('body', true, details),
        { expanded: true, outputPad },
        theme,
      ) as Component
      return box
        .render(120)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
    }
    const leadingSpaces = (lines: string[]) =>
      Math.min(...lines.map((line) => line.length - line.trimStart().length))
    expect(leadingSpaces(render(2))).toBe(leadingSpaces(render(0)) + 2)
  })
})

describe('expand/collapse interaction', () => {
  const details = { kind: 'done', jobs: ['done #1 task'] }

  const renderComponent = (expanded: boolean) =>
    renderSubagentMessage(
      makeMessage(
        'collapsed preview\nsecond line\nthird line\nhidden body',
        true,
        details,
      ),
      { expanded, outputPad: 0 },
      theme,
    ) as Container & { setExpanded(expanded: boolean): void }

  it('setExpanded toggles between collapsed and expanded rendering', () => {
    const component = renderComponent(false)
    expect(component.render(120).join('\n')).not.toContain('hidden body')

    component.setExpanded(true)
    const expanded = component.render(120).join('\n')
    expect(expanded).toContain('hidden body')
    expect(expanded).not.toContain('expand')

    component.setExpanded(true)
    expect(component.render(120).join('\n')).toBe(expanded)

    component.setExpanded(false)
    const collapsed = component.render(120).join('\n')
    expect(collapsed).not.toContain('expand')
    expect(collapsed).not.toContain('hidden body')
  })

  it('uses options.expanded as the initial state', () => {
    expect(renderComponent(true).render(120).join('\n')).toContain(
      'hidden body',
    )
  })

  it('left click toggles expansion', () => {
    const component = renderComponent(false)
    component.handleMouse(clickEvent())
    expect(component.render(120).join('\n')).toContain('hidden body')

    component.handleMouse(clickEvent())
    expect(component.render(120).join('\n')).not.toContain('hidden body')
  })

  it('ignores non-left-click mouse events', () => {
    const component = renderComponent(false)
    component.handleMouse({ ...clickEvent(), type: 'move' })
    component.handleMouse({ ...clickEvent(), button: 'right' })
    expect(component.render(120).join('\n')).not.toContain('hidden body')
  })

  it('invalidate() rerenders identical output and keeps click toggling', () => {
    const component = renderComponent(false)
    const before = component.render(120).join('\n')
    component.invalidate()
    expect(component.render(120).join('\n')).toBe(before)

    component.handleMouse(clickEvent())
    expect(component.render(120).join('\n')).toContain('hidden body')
  })
})
