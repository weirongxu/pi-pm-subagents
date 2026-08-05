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

export interface CustomSelectItem {
  readonly key: string
  readonly text: string
}

export interface CustomSelectOptions {
  readonly items: readonly CustomSelectItem[]
  readonly title?: string
  readonly placeholder?: string
  readonly maxVisible?: number
}

/** Open a searchable, height-limited selector over `{ key, text }` items. */
export async function customSelect(
  ctx: ExtensionContext,
  options: CustomSelectOptions,
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    return new CustomSelectComponent(
      tui,
      theme,
      options,
      (key) => {
        done(key)
      },
      () => {
        done(undefined)
      },
    )
  })
}

/**
 * Searchable, height-limited selector over a list of `{ key, text }` items.
 * Returns the picked item's `key` (or undefined on cancel).
 */
export class CustomSelectComponent extends Container implements Focusable {
  readonly #tui: TUI
  readonly #theme: Theme
  readonly #items: readonly CustomSelectItem[]
  readonly #placeholder: string
  readonly #maxVisible: number
  readonly #searchInput: Input
  readonly #listContainer: Container
  readonly #onSelect: (key: string) => void
  readonly #onCancel: () => void
  #focused = false
  #filtered: CustomSelectItem[]
  #selectedIndex = 0

  constructor(
    tui: TUI,
    theme: Theme,
    options: CustomSelectOptions,
    onSelect: (key: string) => void,
    onCancel: () => void,
  ) {
    super()
    this.#tui = tui
    this.#theme = theme
    this.#items = options.items
    this.#placeholder = options.placeholder ?? 'filter'
    this.#maxVisible = options.maxVisible ?? 10
    this.#onSelect = onSelect
    this.#onCancel = onCancel
    this.#filtered = [...this.#items]

    const borderColor = (s: string) => theme.fg('borderMuted', s)

    this.addChild(new DynamicBorder(borderColor))
    this.addChild(new Spacer(1))
    this.addChild(
      new Text(theme.fg('accent', theme.bold(options.title ?? 'Select')), 1, 0),
    )
    this.addChild(new Spacer(1))
    this.addChild(new Text(theme.fg('muted', this.#placeholder), 1, 0))

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

  #confirm(): void {
    const picked = this.#filtered[this.#selectedIndex]
    if (picked) this.#onSelect(picked.key)
  }

  #refilter(query: string): void {
    const needle = query.trim().toLowerCase()
    const source: CustomSelectItem[] = [...this.#items]
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
      const prefix = i === this.#selectedIndex ? '→ ' : '  '
      const text =
        i === this.#selectedIndex
          ? this.#theme.fg('accent', item.text)
          : item.text
      this.#listContainer.addChild(new Text(`${prefix}${text}`, 1, 0))
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
