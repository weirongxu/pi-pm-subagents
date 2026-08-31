import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  DynamicBorder,
  keyText,
  type Theme,
} from '@earendil-works/pi-coding-agent'
import type { Focusable, TUI } from '@earendil-works/pi-tui'
import {
  Container,
  fuzzyFilter,
  getKeybindings,
  Input,
  Key,
  matchesKey,
  Spacer,
  Text,
} from '@earendil-works/pi-tui'

export interface ScopedModelsItem {
  readonly key: string
  readonly text: string
  readonly provider: string
}

export interface ScopedModelsOptions {
  readonly items: readonly ScopedModelsItem[]
  readonly initialChecked: readonly string[]
  readonly title?: string
}

export async function scopedModelsEditor(
  ctx: ExtensionContext,
  options: ScopedModelsOptions,
): Promise<string[] | undefined> {
  return ctx.ui.custom<string[] | undefined>(
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

class ScopedModelsEditorComponent extends Container implements Focusable {
  readonly #tui: TUI
  readonly #theme: Theme
  readonly #items: readonly ScopedModelsItem[]
  readonly #title: string
  readonly #maxVisible = 10
  readonly #searchInput: Input
  readonly #listContainer: Container
  readonly #footerText: Text
  readonly #onDone: (result: string[]) => void
  readonly #onCancel: () => void
  #focused = false
  #enabled: string[]
  #filtered: ScopedModelsItem[]
  #selectedIndex = 0

  constructor(
    tui: TUI,
    theme: Theme,
    options: ScopedModelsOptions,
    onDone: (result: string[]) => void,
    onCancel: () => void,
  ) {
    super()
    this.#tui = tui
    this.#theme = theme
    this.#items = options.items
    this.#title = options.title ?? 'Select'
    this.#onDone = onDone
    this.#onCancel = onCancel
    this.#enabled = [...options.initialChecked]
    this.#filtered = this.#buildItems()

    const borderColor = (s: string) => theme.fg('borderMuted', s)

    this.addChild(new DynamicBorder(borderColor))
    this.addChild(new Spacer(1))
    this.addChild(new Text(theme.fg('accent', theme.bold(this.#title)), 0, 0))
    this.addChild(new Spacer(1))
    this.addChild(
      new Text(
        theme.fg('muted', `${keyText('app.models.save')} to save to settings.`),
        0,
        0,
      ),
    )
    this.addChild(new Spacer(1))

    this.#searchInput = new Input()
    this.addChild(this.#searchInput)
    this.addChild(new Spacer(1))

    this.#listContainer = new Container()
    this.addChild(this.#listContainer)
    this.addChild(new Spacer(1))

    this.#footerText = new Text('', 0, 0)
    this.addChild(this.#footerText)
    this.addChild(new DynamicBorder(borderColor))

    this.#renderFooter()
    this.#renderList()
  }

  get focused(): boolean {
    return this.#focused
  }

  set focused(value: boolean) {
    this.#focused = value
    this.#searchInput.focused = value
  }

  #isEnabled(key: string): boolean {
    return this.#enabled.includes(key)
  }

  #toggle(key: string): void {
    const index = this.#enabled.indexOf(key)
    if (index >= 0) {
      this.#enabled = [
        ...this.#enabled.slice(0, index),
        ...this.#enabled.slice(index + 1),
      ]
    } else {
      this.#enabled = [...this.#enabled, key]
    }
  }

  #enableAll(targetIds?: string[]): void {
    const targets = targetIds ?? this.#items.map((i) => i.key)
    const result = [...this.#enabled]
    for (const id of targets) {
      if (!result.includes(id)) {
        result.push(id)
      }
    }
    this.#enabled = result
  }

  #clearAll(targetIds?: string[]): void {
    const targets = new Set(targetIds ?? this.#enabled)
    this.#enabled = this.#enabled.filter((id) => !targets.has(id))
  }

  #toggleProvider(provider: string): void {
    if (!provider) return

    const providerIds = this.#items
      .filter((i) => i.provider === provider)
      .map((i) => i.key)
    const allEnabled = providerIds.every((id) => this.#isEnabled(id))
    if (allEnabled) {
      this.#clearAll(providerIds)
    } else {
      this.#enableAll(providerIds)
    }
  }

  #move(key: string, delta: number): void {
    const index = this.#enabled.indexOf(key)
    if (index < 0) return

    const newIndex = index + delta
    if (newIndex < 0 || newIndex >= this.#enabled.length) return

    const result = [...this.#enabled]
    const [removed] = result.splice(index, 1)
    if (removed === undefined) return
    result.splice(newIndex, 0, removed)
    this.#enabled = result
  }

  #commit(): void {
    this.#onDone([...this.#enabled])
  }

  #buildItems(): ScopedModelsItem[] {
    const enabledSet = new Set(this.#enabled)
    const enabledItems = this.#enabled
      .map((key) => this.#items.find((i) => i.key === key))
      .filter((i): i is ScopedModelsItem => i !== undefined)

    const disabledItems = this.#items.filter((i) => !enabledSet.has(i.key))

    return [...enabledItems, ...disabledItems]
  }

  #refilter(query: string): void {
    if (!query) {
      this.#filtered = this.#buildItems()
      this.#selectedIndex = 0
      return
    }

    const items = this.#buildItems()
    this.#filtered = fuzzyFilter(items, query, (item) => item.text)
    this.#selectedIndex = 0
  }

  #renderList(): void {
    this.#listContainer.clear()

    if (this.#filtered.length === 0) {
      this.#listContainer.addChild(
        new Text(this.#theme.fg('muted', '  No matching models'), 0, 0),
      )
      return
    }

    const startIndex = Math.max(
      0,
      Math.min(
        this.#selectedIndex - Math.floor(this.#maxVisible / 2),
        this.#filtered.length - this.#maxVisible,
      ),
    )
    const endIndex = Math.min(
      startIndex + this.#maxVisible,
      this.#filtered.length,
    )

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.#filtered[i]
      if (!item) continue

      const isSelected = i === this.#selectedIndex
      const enabled = this.#isEnabled(item.key)

      const prefix = isSelected ? this.#theme.fg('accent', '→ ') : '  '
      const modelText = isSelected
        ? this.#theme.fg('accent', item.text)
        : item.text
      const providerBadge = item.provider
        ? this.#theme.fg('muted', ` [${item.provider}]`)
        : ''
      const status = enabled
        ? this.#theme.fg('success', ' ✓')
        : this.#theme.fg('dim', ' ✗')

      this.#listContainer.addChild(
        new Text(`${prefix}${modelText}${providerBadge}${status}`, 0, 0),
      )
    }

    if (startIndex > 0 || endIndex < this.#filtered.length) {
      this.#listContainer.addChild(
        new Text(
          this.#theme.fg(
            'muted',
            `  (${this.#selectedIndex + 1}/${this.#filtered.length})`,
          ),
          0,
        ),
      )
    }
  }

  #renderFooter(): void {
    const enabledCount = this.#enabled.length
    const countText = `${enabledCount}/${this.#items.length} enabled`

    const parts = [
      `${keyText('tui.select.confirm')} toggle`,
      `${keyText('app.models.enableAll')} all`,
      `${keyText('app.models.clearAll')} clear`,
      `${keyText('app.models.toggleProvider')} provider`,
      `${keyText('app.models.reorderUp')}/${keyText('app.models.reorderDown')} reorder`,
      `${keyText('app.models.save')} save`,
      countText,
    ]

    this.#footerText.setText(this.#theme.fg('dim', `  ${parts.join(' · ')}`))
  }

  #notify(): void {
    this.#tui.requestRender()
  }

  handleInput(data: string): void {
    const kb = getKeybindings()

    if (kb.matches(data, 'tui.select.up')) {
      if (this.#filtered.length === 0) return
      this.#selectedIndex =
        this.#selectedIndex === 0
          ? this.#filtered.length - 1
          : this.#selectedIndex - 1
      this.#renderList()
      this.#notify()
      return
    }

    if (kb.matches(data, 'tui.select.down')) {
      if (this.#filtered.length === 0) return
      this.#selectedIndex =
        this.#selectedIndex === this.#filtered.length - 1
          ? 0
          : this.#selectedIndex + 1
      this.#renderList()
      this.#notify()
      return
    }

    const reorderUp = kb.matches(data, 'app.models.reorderUp')
    const reorderDown = kb.matches(data, 'app.models.reorderDown')

    if (reorderUp || reorderDown) {
      const item = this.#filtered[this.#selectedIndex]
      if (item && this.#isEnabled(item.key)) {
        const delta = reorderUp ? -1 : 1
        const currentIndex = this.#enabled.indexOf(item.key)
        const newIndex = currentIndex + delta

        if (newIndex >= 0 && newIndex < this.#enabled.length) {
          this.#move(item.key, delta)
          this.#selectedIndex += delta
          this.#refilter(this.#searchInput.getValue())
          this.#renderList()
          this.#renderFooter()
          this.#notify()
        }
      }
      return
    }

    if (kb.matches(data, 'tui.select.confirm')) {
      const item = this.#filtered[this.#selectedIndex]
      if (item) {
        this.#toggle(item.key)
        this.#refilter(this.#searchInput.getValue())
        this.#renderList()
        this.#renderFooter()
        this.#notify()
      }
      return
    }

    if (kb.matches(data, 'app.models.enableAll')) {
      const query = this.#searchInput.getValue()
      const targetIds = query ? this.#filtered.map((i) => i.key) : undefined
      this.#enableAll(targetIds)
      this.#refilter(query)
      this.#renderList()
      this.#renderFooter()
      this.#notify()
      return
    }

    if (kb.matches(data, 'app.models.clearAll')) {
      const query = this.#searchInput.getValue()
      const targetIds = query ? this.#filtered.map((i) => i.key) : undefined
      this.#clearAll(targetIds)
      this.#refilter(query)
      this.#renderList()
      this.#renderFooter()
      this.#notify()
      return
    }

    if (kb.matches(data, 'app.models.toggleProvider')) {
      const item = this.#filtered[this.#selectedIndex]
      if (item?.provider) {
        this.#toggleProvider(item.provider)
        this.#refilter(this.#searchInput.getValue())
        this.#renderList()
        this.#renderFooter()
        this.#notify()
      }
      return
    }

    if (kb.matches(data, 'app.models.save')) {
      this.#commit()
      return
    }

    if (matchesKey(data, Key.ctrl('c'))) {
      if (this.#searchInput.getValue()) {
        this.#searchInput.setValue('')
        this.#refilter('')
        this.#renderList()
        this.#notify()
      } else {
        this.#onCancel()
      }
      return
    }

    if (matchesKey(data, Key.escape)) {
      this.#onCancel()
      return
    }

    this.#searchInput.handleInput(data)
    this.#refilter(this.#searchInput.getValue())
    this.#renderList()
    this.#renderFooter()
    this.#notify()
  }
}
