import type { Component, TUI } from '@earendil-works/pi-tui'
import { Key, matchesKey } from '@earendil-works/pi-tui'
import type { Theme } from '@earendil-works/pi-coding-agent'

import { truncateText } from '../utils/truncate.js'

export interface ScrollViewOptions {
  /** The content this view wraps: any pi-tui Component (Markdown, Container, …). */
  readonly child: Component
  /** Rows available to the scroll area — the parent reserves chrome outside. */
  readonly viewportHeight: () => number
  /** Pin to new content as it arrives (streaming viewers). Default false. */
  readonly autoFollow?: boolean
}

/**
 * A scrollable viewport that wraps a content source. Implements the pi-tui
 * `Component` interface: {@link ScrollView} owns the offset (with auto-follow),
 * a proportional scrollbar, and the scroll keybindings, and renders nothing
 * but the visible window of its child plus the bar. Headers, footers, choice
 * lists and hints live outside, in the parent component that holds this one.
 */
export class ScrollView implements Component {
  #offset = 0
  #autoFollow: boolean
  #total = 0
  #viewportHeight = 0
  readonly #tui: TUI
  readonly #theme: Theme
  readonly #child: Component
  readonly #viewportHeightFor: () => number
  readonly #offWheel: () => void
  #wheelDir = 0
  #wheelSpeed = 0
  #wheelAt = 0

  constructor(tui: TUI, theme: Theme, options: ScrollViewOptions) {
    this.#tui = tui
    this.#theme = theme
    this.#child = options.child
    this.#viewportHeightFor = options.viewportHeight
    this.#autoFollow = options.autoFollow ?? false
    this.#offWheel = tui.addInputListener((data) => this.#handleWheel(data))
  }

  /** Unregister the wheel input listener. */
  dispose(): void {
    this.#offWheel()
  }

  /** Top-most visible line after the last render. */
  get offset(): number {
    return this.#offset
  }

  /** Total content lines after the last render. */
  get total(): number {
    return this.#total
  }

  /** Viewport height used by the last render. */
  get viewportHeight(): number {
    return this.#viewportHeight
  }

  render(width: number): string[] {
    if (width < 4) return []
    const contentWidth = Math.max(1, width - 2)
    const lines = this.#child.render(contentWidth)
    this.#total = lines.length
    this.#viewportHeight = Math.max(0, this.#viewportHeightFor())
    this.#offset = this.#clamp(this.#offset)
    if (this.#autoFollow) this.#offset = this.#maxOffset

    const rows = Math.min(
      this.#viewportHeight,
      Math.max(0, lines.length - this.#offset),
    )
    const bar = this.#column(rows)
    const track = this.#theme.fg('dim', '│')
    const out: string[] = []
    for (let i = 0; i < rows; i++) {
      const line = truncateText(
        lines[this.#offset + i] ?? '',
        contentWidth,
        undefined,
        true,
      )
      out.push(`${line} ${bar[i] ?? track}`)
    }
    return out
  }

  handleInput(data: string): void {
    if (this.#viewportHeight === 0) return // not laid out yet
    const before = this.#offset
    if (matchesKey(data, Key.up) || data === 'k') this.#moveTo(this.#offset - 1)
    else if (matchesKey(data, Key.down) || data === 'j')
      this.#moveTo(this.#offset + 1)
    else if (
      data === 'u' ||
      data === 'e' ||
      matchesKey(data, Key.ctrl('u')) ||
      matchesKey(data, Key.pageUp)
    )
      this.#moveTo(this.#offset - this.#halfPage)
    else if (
      data === 'd' ||
      data === ' ' ||
      matchesKey(data, Key.ctrl('d')) ||
      matchesKey(data, Key.pageDown)
    )
      this.#moveTo(this.#offset + this.#halfPage)
    else if (data === 'g' || matchesKey(data, Key.home)) this.#moveTo(0)
    else if (data === 'G' || matchesKey(data, Key.end))
      this.#moveTo(this.#maxOffset)
    else if (this.#child.handleInput) {
      // non-scroll input goes to the wrapped child (it may be interactive)
      this.#child.handleInput(data)
      this.#tui.requestRender()
      return
    }
    if (this.#offset !== before) this.#tui.requestRender()
  }

  invalidate(): void {
    this.#child.invalidate()
  }

  // Overlays are composed via bare render() calls, bypassing the layout engine,
  // so wheel events never reach us through routeWheel/handleMouse — the only hook
  // is addInputListener, which runs before alt-screen wheel routing.
  #handleWheel(data: string): { consume: true } | undefined {
    // eslint-disable-next-line no-control-regex -- SGR mouse sequences contain control characters
    const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data)
    if (!match || match[4] === 'm') return undefined
    const button = Number(match[1])
    if (button < 64 || button > 73) return undefined
    const code = button & 63
    let dir = 0
    if (code === 0 || code === 8) dir = -1
    else if (code === 1 || code === 9) dir = 1
    if (dir === 0) return undefined
    const now = performance.now()
    this.#wheelSpeed =
      this.#wheelDir === dir && now - this.#wheelAt <= 100
        ? Math.min(6, this.#wheelSpeed + 1)
        : 1
    this.#wheelDir = dir
    this.#wheelAt = now
    const lines = this.#wheelSpeed * (button & 8 ? 5 : 1)
    this.#moveTo(this.#offset + dir * lines)
    this.#tui.requestRender()
    return { consume: true }
  }

  get #halfPage(): number {
    return Math.max(1, Math.floor(this.#viewportHeight / 2))
  }

  get #maxOffset(): number {
    return Math.max(0, this.#total - this.#viewportHeight)
  }

  #clamp(value: number): number {
    return Math.max(0, Math.min(value, this.#maxOffset))
  }

  #moveTo(value: number): void {
    this.#offset = this.#clamp(value)
    this.#autoFollow = this.#offset >= this.#maxOffset
  }

  #column(rows: number): string[] {
    const max = this.#maxOffset
    const size =
      max > 0
        ? Math.max(
            1,
            Math.round(
              (this.#viewportHeight / this.#total) * this.#viewportHeight,
            ),
          )
        : 0
    const start =
      max > 0
        ? Math.round((this.#offset / max) * (this.#viewportHeight - size))
        : 0
    const thumb = this.#theme.fg('muted', '█')
    const track = this.#theme.fg('dim', '│')
    const column: string[] = []
    for (let i = 0; i < rows; i++) {
      column.push(i >= start && i < start + size ? thumb : track)
    }
    return column
  }
}
