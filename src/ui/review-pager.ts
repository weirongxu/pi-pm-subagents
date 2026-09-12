import {
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  type Theme,
} from '@earendil-works/pi-coding-agent'
import {
  type Focusable,
  Key,
  Markdown,
  matchesKey,
  type TUI,
} from '@earendil-works/pi-tui'

import { BorderView } from './border-view.js'
import { renderFooterKeys } from './footer.js'
import {
  capEditorLines,
  createInlineEditor,
  EDITOR_MAX_LINES,
} from './inline-editor.js'
import { ScrollView } from './scroll-view.js'

const VIEWPORT_HEIGHT_PCT = 80
const OVERLAY_WIDTH_PCT = '90%'
const REVIEW_NOTIFY_EVENT = 'pi-notify:notify'

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

  const editor = createInlineEditor(tui, theme)
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
          ['PgUp/PgDn', 'plan ½page'],
        ]
      : [
          ['↑↓/n/p', 'select'],
          [`1-${Math.min(choices.length, 9)}`, 'choose'],
          ['j/k', 'line up/down'],
          ['u/e/d ␣ PgUp/PgDn', '½page'],
          ['g/G', 'start/end'],
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
      renderFooterKeys(theme, footerKeys, width),
    ]
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
    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) {
      scroll.handleInput(data)
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
