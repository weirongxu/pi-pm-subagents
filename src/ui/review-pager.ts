import {
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  type Theme,
} from '@earendil-works/pi-coding-agent'
import {
  Editor,
  type Focusable,
  Markdown,
  matchesKey,
  type TUI,
} from '@earendil-works/pi-tui'

import { truncateText } from '../utils/truncate.js'
import { BorderView } from './border-view.js'
import { ScrollView } from './scroll-view.js'

const VIEWPORT_HEIGHT_PCT = 80
const OVERLAY_WIDTH_PCT = '90%'
const REVIEW_NOTIFY_EVENT = 'pi-notify:notify'

const EDITOR_LINES_BEFORE = 4
const EDITOR_LINES_AFTER = 3
const EDITOR_BORDER_LINES = 2
const EDITOR_WINDOW_LINES = EDITOR_LINES_BEFORE + 1 + EDITOR_LINES_AFTER
const EDITOR_MAX_LINES = EDITOR_WINDOW_LINES + EDITOR_BORDER_LINES
const CURSOR_SEQ = '\x1b[7m'

/**
 * Assumes editor.render() output is [topBorder, ...content, bottomBorder];
 * this editor never sets an autocomplete provider, so no trailing list lines.
 * `formatHidden` counts hidden lines among the rendered output only (Editor
 * already self-truncates to its own max visible lines, so it may undercount
 * the editor's real buffer size).
 */
export function capEditorLines(
  lines: string[],
  formatHidden: (hidden: number) => string,
): string[] {
  if (lines.length <= EDITOR_MAX_LINES) return lines
  const topBorder = lines[0] ?? ''
  const bottomBorder = lines[lines.length - 1] ?? ''
  const content = lines.slice(1, -1)
  const windowSize = EDITOR_WINDOW_LINES
  const cursor = content.findIndex((line) => line.includes(CURSOR_SEQ))
  if (cursor === -1) {
    const capped = [
      ...content.slice(0, windowSize - 1),
      formatHidden(content.length - (windowSize - 1)),
    ]
    return [topBorder, ...capped, bottomBorder]
  }
  const start = Math.max(
    0,
    Math.min(cursor - EDITOR_LINES_BEFORE, content.length - windowSize),
  )
  const capped = content.slice(start, start + windowSize)
  if (start > 0) capped[0] = formatHidden(start)
  if (start + windowSize < content.length)
    capped[capped.length - 1] = formatHidden(
      content.length - (start + windowSize),
    )
  return [topBorder, ...capped, bottomBorder]
}

export interface ReviewChoice {
  readonly id: string
  readonly label: string
  readonly inlineEditor?: boolean
  readonly action?: (updatePrompt?: string) => Promise<void> | void
}

export interface ReviewPagerOptions {
  readonly title: string
  readonly plan: string
  readonly choices: readonly ReviewChoice[]
}

export interface ReviewPagerResult {
  readonly choiceId: string
  readonly updatePrompt?: string
}

type Mode = 'menu' | 'edit'

export function createReviewPagerComponent(
  tui: TUI,
  theme: Theme,
  options: ReviewPagerOptions,
  done: (result: ReviewPagerResult | undefined) => void,
): Focusable & {
  render: (width: number) => string[]
  handleInput: (data: string) => void
  invalidate: () => void
} {
  const { title, plan, choices } = options
  let selected = 0
  let mode: Mode = 'menu'
  let focused = false

  const markdown = new Markdown(plan, 0, 0, getMarkdownTheme())
  const scroll = new ScrollView(tui, theme, {
    child: markdown,
    viewportHeight: () => {
      const chromeLines =
        mode === 'edit' ? EDITOR_MAX_LINES + 3 : choices.length + 3
      return Math.max(
        mode === 'edit' ? 4 : 3,
        Math.floor((tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) -
          chromeLines -
          3,
      )
    },
  })

  const editor = new Editor(tui, {
    borderColor: (str) => theme.fg('borderMuted', str),
    selectList: {
      selectedPrefix: (text) => theme.fg('accent', text),
      selectedText: (text) => theme.fg('accent', text),
      description: (text) => theme.fg('muted', text),
      scrollInfo: (text) => theme.fg('dim', text),
      noMatch: (text) => theme.fg('warning', text),
    },
  })
  const inlineChoice = choices.find((c) => c.inlineEditor)
  editor.focused = focused
  editor.onSubmit = (text) => {
    if (inlineChoice) done({ choiceId: inlineChoice.id, updatePrompt: text })
  }

  function renderChoices(): string[] {
    return choices.map((choice, index) =>
      index === selected
        ? theme.fg('accent', `→ ${choice.label}`)
        : `  ${choice.label}`,
    )
  }

  function render(width: number): string[] {
    const editing = mode === 'edit'
    const footerKeys: [string, string][] = editing
      ? [
          ['Enter', 'submit'],
          ['shift+enter', 'newline'],
          ['esc', 'back to choices'],
        ]
      : [
          ['↑↓/n/p', 'select'],
          [`1-${choices.length}`, 'jump'],
          ['j/k line', 'line'],
          ['u/e/d ␣', 'PgUp/Dn ½page'],
          ['g/G', 'Home/End jump'],
          ['Enter', 'confirm'],
          ['q/esc', 'cancel'],
        ]
    const editorSection = editing
      ? [
          theme.fg('muted', '─'.repeat(width)),
          theme.fg('muted', 'Update the plan:'),
          ...capEditorLines(editor.render(width), (n) =>
            theme.fg('dim', `… +${n} hidden`),
          ),
        ]
      : []
    const choiceSection = editing
      ? []
      : [
          theme.fg('muted', '─'.repeat(width)),
          ...renderChoices(),
          theme.fg('muted', '─'.repeat(width)),
        ]
    return [
      theme.fg('accent', theme.bold(title)),
      ...scroll.render(width),
      ...choiceSection,
      ...editorSection,
      footerLine(width, footerKeys),
    ]
  }

  function footerLine(width: number, keys: [string, string][]): string {
    const sep = theme.fg('dim', ' · ')
    return truncateText(
      keys
        .map(
          ([key, desc]) =>
            `${theme.fg('syntaxKeyword', key)} ${theme.fg('success', desc)}`,
        )
        .join(sep),
      width,
    )
  }

  function handleMenuInput(data: string): void {
    const index = /^[1-9]$/.test(data) ? Number(data) - 1 : -1
    if (index >= 0 && choices[index] !== undefined) {
      selectChoice(choices[index])
      return
    }
    if (data === 'n' || matchesKey(data, 'down')) {
      selected = Math.min(choices.length - 1, selected + 1)
      tui.requestRender()
      return
    }
    if (data === 'p' || matchesKey(data, 'up')) {
      selected = Math.max(0, selected - 1)
      tui.requestRender()
      return
    }
    if (matchesKey(data, 'enter')) {
      selectChoice(choices[selected])
      return
    }
    if (matchesKey(data, 'escape') || data === 'q') {
      done(undefined)
      return
    }
    scroll.handleInput(data)
  }

  function selectChoice(choice: ReviewChoice | undefined): void {
    if (!choice) return
    if (choice.inlineEditor && inlineChoice) {
      mode = 'edit'
      editor.focused = true
      tui.requestRender()
      return
    }
    done({ choiceId: choice.id })
  }

  function handleEditInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      mode = 'menu'
      editor.focused = focused
      tui.requestRender()
      return
    }
    if (data === '\x03') {
      done(undefined)
      return
    }
    editor.handleInput(data)
    tui.requestRender()
  }

  return {
    get focused(): boolean {
      return focused
    },
    set focused(value: boolean) {
      focused = value
      if (mode === 'edit') editor.focused = value
    },
    render,
    handleInput(data: string) {
      if (mode === 'edit') handleEditInput(data)
      else handleMenuInput(data)
    },
    invalidate() {
      scroll.invalidate()
      editor.invalidate()
    },
  }
}

export function renderReviewPager(
  ctx: ExtensionContext,
  options: ReviewPagerOptions,
): Promise<ReviewPagerResult | undefined> {
  return ctx.ui.custom<ReviewPagerResult | undefined>(
    (tui, theme, _keybindings, done) => {
      const component = createReviewPagerComponent(tui, theme, options, done)
      return new BorderView(theme, { child: component })
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: 'center',
        width: OVERLAY_WIDTH_PCT,
        maxHeight: `${VIEWPORT_HEIGHT_PCT}%`,
      },
    },
  )
}

export async function askHowToProceed(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: ReviewPagerOptions,
): Promise<void> {
  ctx.ui.setWorkingVisible(false)
  pi.events.emit(REVIEW_NOTIFY_EVENT, options.title)
  try {
    const result = await renderReviewPager(ctx, options)
    if (!result) return
    const choice = options.choices.find((c) => c.id === result.choiceId)
    if (!choice?.action) return
    if (!result.updatePrompt) await choice.action()
    else await choice.action(result.updatePrompt)
  } finally {
    ctx.ui.setWorkingVisible(true)
  }
}
