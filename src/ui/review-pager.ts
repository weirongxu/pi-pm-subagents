import {
  type Component,
  type Editor,
  type Focusable,
  Key,
  Markdown,
  type TUI,
  matchesKey,
} from '@earendil-works/pi-tui'
import {
  EDITOR_MAX_LINES,
  capEditorLines,
  createInlineEditor,
} from './inline-editor.js'
import {
  type ExtensionContext,
  type Theme,
  getMarkdownTheme,
} from '@earendil-works/pi-coding-agent'
import { BorderView } from './border-view.js'
import { ScrollView } from './scroll-view.js'
import { renderFooterKeys } from './footer.js'
import { truncateText } from '../utils/truncate.js'

const VIEWPORT_HEIGHT_PCT = 80
const OVERLAY_WIDTH_PCT = '90%'

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

export class ReviewPager implements Component, Focusable {
  readonly #tui: TUI
  readonly #theme: Theme
  readonly #title: string
  readonly #choices: readonly ReviewChoice[]
  readonly #done: (result: ReviewPagerResult | undefined) => void
  readonly #markdown: Markdown
  readonly #scroll: ScrollView
  readonly #editor: Editor
  readonly #inlineChoice: ReviewChoice | undefined
  #selected = 0
  #mode: Mode = 'menu'
  #focused = false

  constructor({
    tui,
    theme,
    options: { title, plan, choices },
    done,
  }: {
    tui: TUI
    theme: Theme
    options: ReviewPagerOptions
    done: (result: ReviewPagerResult | undefined) => void
  }) {
    this.#tui = tui
    this.#theme = theme
    this.#title = title
    this.#choices = choices
    this.#done = done
    this.#markdown = new Markdown(plan, 0, 0, getMarkdownTheme())
    this.#scroll = new ScrollView(tui, theme, {
      child: this.#markdown,
      viewportHeight: () => {
        const chromeLines =
          this.#mode === 'edit' ? EDITOR_MAX_LINES + 3 : choices.length + 3
        return Math.max(
          this.#mode === 'edit' ? 4 : 3,
          Math.floor((tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) -
            chromeLines -
            3,
        )
      },
    })
    this.#editor = createInlineEditor(tui, theme)
    this.#inlineChoice = choices.find((c) => c.inlineEditor)
    this.#editor.focused = false
    this.#editor.onSubmit = (text) => {
      const inlineChoice = this.#inlineChoice
      if (inlineChoice)
        this.#finish({ choiceId: inlineChoice.id, updatePrompt: text })
    }
  }

  get focused(): boolean {
    return this.#focused
  }

  set focused(value: boolean) {
    this.#focused = value
    if (this.#mode === 'edit') this.#editor.focused = value
  }

  #finish(result: ReviewPagerResult | undefined): void {
    this.#scroll.dispose()
    this.#done(result)
  }

  #renderChoices(width: number): string[] {
    return this.#choices.map((choice, index) => {
      const label = truncateText(choice.label, width - 2)
      return index === this.#selected
        ? this.#theme.fg('accent', `→ ${label}`)
        : `  ${label}`
    })
  }

  render(width: number): string[] {
    const theme = this.#theme
    const editing = this.#mode === 'edit'
    const footerKeys: [string, string][] = editing
      ? [
          ['Enter', 'submit'],
          ['shift+enter', 'newline'],
          ['esc', 'back to choices'],
          ['PgUp/PgDn', 'plan ½page'],
        ]
      : [
          ['↑↓/n/p', 'select'],
          [`1-${Math.min(this.#choices.length, 9)}`, 'choose'],
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
          ...capEditorLines(this.#editor.render(width), (n) =>
            theme.fg('dim', `… +${n} hidden`),
          ),
        ]
      : []
    const choiceSection = editing
      ? []
      : [
          theme.fg('muted', '─'.repeat(width)),
          ...this.#renderChoices(width),
          theme.fg('muted', '─'.repeat(width)),
        ]
    return [
      theme.fg('accent', theme.bold(truncateText(this.#title, width))),
      ...this.#scroll.render(width),
      ...choiceSection,
      ...editorSection,
      renderFooterKeys(theme, footerKeys, width),
    ]
  }

  #handleMenuInput(data: string): void {
    const choices = this.#choices
    const index = /^[1-9]$/.test(data) ? Number(data) - 1 : -1
    if (index >= 0 && choices[index] !== undefined) {
      this.#selectChoice(choices[index])
      return
    }
    if (data === 'n' || matchesKey(data, 'down')) {
      this.#selected = Math.min(choices.length - 1, this.#selected + 1)
      this.#tui.requestRender()
      return
    }
    if (data === 'p' || matchesKey(data, 'up')) {
      this.#selected = Math.max(0, this.#selected - 1)
      this.#tui.requestRender()
      return
    }
    if (matchesKey(data, 'enter')) {
      this.#selectChoice(choices[this.#selected])
      return
    }
    if (matchesKey(data, 'escape') || data === 'q') {
      this.#finish(undefined)
      return
    }
    this.#scroll.handleInput(data)
  }

  #selectChoice(choice: ReviewChoice | undefined): void {
    if (!choice) return
    if (choice.inlineEditor && this.#inlineChoice) {
      this.#mode = 'edit'
      this.#editor.focused = true
      this.#tui.requestRender()
      return
    }
    this.#finish({ choiceId: choice.id })
  }

  #handleEditInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      this.#mode = 'menu'
      this.#editor.focused = this.#focused
      this.#tui.requestRender()
      return
    }
    if (data === '\x03') {
      this.#finish(undefined)
      return
    }
    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) {
      this.#scroll.handleInput(data)
      return
    }
    this.#editor.handleInput(data)
    this.#tui.requestRender()
  }

  handleInput(data: string): void {
    if (this.#mode === 'edit') this.#handleEditInput(data)
    else this.#handleMenuInput(data)
  }

  invalidate(): void {
    this.#scroll.invalidate()
    this.#editor.invalidate()
  }
}

export function renderReviewPager(
  ctx: ExtensionContext,
  options: ReviewPagerOptions,
): Promise<ReviewPagerResult | undefined> {
  return ctx.ui.custom<ReviewPagerResult | undefined>(
    (tui, theme, _keybindings, done) => {
      const component = new ReviewPager({ tui, theme, options, done })
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
  ctx: ExtensionContext,
  options: ReviewPagerOptions,
): Promise<void> {
  ctx.ui.setWorkingVisible(false)
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
