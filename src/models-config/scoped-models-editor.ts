import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { DynamicBorder } from '@earendil-works/pi-coding-agent'
import type { Focusable, TUI } from '@earendil-works/pi-tui'
import {
  Container,
  fuzzyFilter,
  Input,
  Key,
  matchesKey,
  Spacer,
  Text,
} from '@earendil-works/pi-tui'

export interface ScopedModelsItem {
  readonly key: string
  readonly text: string
}

export interface ScopedModelsOptions {
  readonly items: readonly ScopedModelsItem[]
  readonly initialChecked: ReadonlySet<string>
  readonly title?: string
}

export async function scopedModelsEditor(
  ctx: ExtensionContext,
  options: ScopedModelsOptions,
): Promise<Set<string> | undefined> {
  return ctx.ui.custom<Set<string> | undefined>(
    (tui, theme, _keybindings, done) => {
      return new ScopedModelsEditorComponent(
        tui,
        theme,
        options,
        (result) => {
          done(result)
        },
        () => {
          done(undefined)
        },
      )
    },
  )
}

export class ScopedModelsEditorComponent
  extends Container
  implements Focusable
{
  readonly #tui: TUI
  readonly #theme: Theme
  readonly #items: readonly ScopedModelsItem[]
  readonly #title: string
  readonly #maxVisible: number
  readonly #searchInput: Input
  readonly #listContainer: Container
  readonly #onDone: (result: Set<string> | undefined) => void
  readonly #onCancel: () => void
  #focused = false
  #checked: Set<string>
  #filtered: ScopedModelsItem[]
  #selectedIndex = 0

  constructor(
    tui: TUI,
    theme: Theme,
    options: ScopedModelsOptions,
    onDone: (result: Set<string> | undefined) => void,
    onCancel: () => void,
  ) {
    super()
    this.#tui = tui
    this.#theme = theme
    this.#items = options.items
    this.#title = options.title ?? 'Select'
    this.#maxVisible = 10
    this.#onDone = onDone
    this.#onCancel = onCancel
    this.#checked = new Set(options.initialChecked)
    this.#filtered = [...this.#items]

    const borderColor = (s: string) => theme.fg('borderMuted', s)

    this.addChild(new DynamicBorder(borderColor))
    this.addChild(new Spacer(1))
    this.addChild(new Text(theme.fg('accent', theme.bold(this.#title)), 1, 0))
    this.addChild(new Spacer(1))
    this.addChild(
      new Text(
        theme.fg('muted', 'Space to toggle | Enter to save | Esc to cancel'),
        1,
        0,
      ),
    )
    this.addChild(new Spacer(1))
    this.addChild(new Text(theme.fg('muted', 'filter'), 1, 0))

    this.#searchInput = new Input()
    this.#searchInput.onSubmit = () => {
      this.#confirm()
    }
    this.addChild(this.#searchInput)
    this.addChild(new Spacer(1))

    this.#listContainer = new Container()
    this.addChild(this.#listContainer)
    this.addChild(new Spacer(1))
    this.addChild(new DynamicBorder(borderColor))

    this.#renderList()
  }

  get focused(): boolean {
    return this.#focused
  }

  set focused(value: boolean) {
    this.#focused = value
    this.#searchInput.focused = value
  }

  handleInput(keyData: string): void {
    if (matchesKey(keyData, Key.up) || matchesKey(keyData, Key.ctrl('p'))) {
      this.#move(-1)
    } else if (
      matchesKey(keyData, Key.down) ||
      matchesKey(keyData, Key.ctrl('n'))
    ) {
      this.#move(1)
    } else if (
      matchesKey(keyData, Key.pageUp) ||
      matchesKey(keyData, Key.ctrl('u'))
    ) {
      this.#move(-this.#maxVisible)
    } else if (
      matchesKey(keyData, Key.pageDown) ||
      matchesKey(keyData, Key.ctrl('d'))
    ) {
      this.#move(this.#maxVisible)
    } else if (matchesKey(keyData, Key.space)) {
      this.#toggle()
    } else if (matchesKey(keyData, Key.enter)) {
      this.#confirm()
    } else if (
      matchesKey(keyData, Key.escape) ||
      matchesKey(keyData, Key.ctrl('c'))
    ) {
      this.#onCancel()
    } else {
      this.#searchInput.handleInput(keyData)
      this.#refilter(this.#searchInput.getValue())
    }
  }

  #move(delta: number): void {
    if (this.#filtered.length === 0) return
    const last = this.#filtered.length - 1
    this.#selectedIndex =
      delta > 0
        ? Math.min(last, this.#selectedIndex + delta)
        : Math.max(0, this.#selectedIndex + delta)
    this.#renderList()
    this.#tui.requestRender()
  }

  #toggle(): void {
    const item = this.#filtered[this.#selectedIndex]
    if (!item) return
    const next = new Set(this.#checked)
    if (next.has(item.key)) {
      next.delete(item.key)
    } else {
      next.add(item.key)
    }
    this.#checked = next
    this.#renderList()
    this.#tui.requestRender()
  }

  #confirm(): void {
    this.#onDone(this.#checked)
  }

  #refilter(query: string): void {
    const needle = query.trim().toLowerCase()
    const source: ScopedModelsItem[] = [...this.#items]
    this.#filtered = needle
      ? fuzzyFilter(source, needle, (item) => item.text)
      : source
    this.#selectedIndex = 0
    this.#renderList()
    this.#tui.requestRender()
  }

  #renderList(): void {
    this.#listContainer.clear()
    const total = this.#filtered.length
    const visible = Math.min(this.#maxVisible, total)
    const start = Math.max(
      0,
      Math.min(
        this.#selectedIndex - Math.floor(this.#maxVisible / 2),
        total - visible,
      ),
    )
    const end = start + visible
    for (let i = start; i < end; i++) {
      const item = this.#filtered[i]
      if (!item) continue
      const checked = this.#checked.has(item.key)
      const prefix = i === this.#selectedIndex ? '→ ' : '  '
      const checkbox = checked ? '[x]' : '[ ]'
      const checkboxColor = checked ? 'accent' : 'muted'
      const text =
        i === this.#selectedIndex
          ? `${prefix}${this.#theme.fg(checkboxColor, checkbox)} ${this.#theme.fg('accent', item.text)}`
          : `${prefix}${this.#theme.fg(checkboxColor, checkbox)} ${item.text}`
      this.#listContainer.addChild(new Text(text, 1, 0))
    }
    if (total > visible) {
      this.#listContainer.addChild(
        new Text(
          this.#theme.fg('muted', `  (${this.#selectedIndex + 1}/${total})`),
          1,
          0,
        ),
      )
    } else if (total === 0) {
      this.#listContainer.addChild(
        new Text(this.#theme.fg('muted', '  No matches'), 1, 0),
      )
    }
  }
}
