import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { truncateToWidth } from '@earendil-works/pi-tui'

export interface BorderViewOptions {
  readonly child: Component
}

/**
 * A border wrapper for pi-tui components. Adds a border around the child
 * component while preserving all its functionality (render, handleInput, invalidate).
 */
export class BorderView implements Component {
  readonly #child: Component
  readonly #theme: Theme

  constructor(theme: Theme, options: BorderViewOptions) {
    this.#child = options.child
    this.#theme = theme
  }

  render(width: number): string[] {
    if (width < 4) return this.#child.render(width)

    const contentWidth = Math.max(1, width - 2)
    const content = this.#child.render(contentWidth)
    const th = this.#theme

    const topBorder = th.fg('dim', `┌${'─'.repeat(contentWidth)}┐`)
    const bottomBorder = th.fg('dim', `└${'─'.repeat(contentWidth)}┘`)
    const leftBorder = th.fg('dim', '│')
    const rightBorder = th.fg('dim', '│')

    const borderedContent = content.map(
      (line) =>
        `${leftBorder}${truncateToWidth(line, contentWidth, undefined, true)}${rightBorder}`,
    )

    return [topBorder, ...borderedContent, bottomBorder]
  }

  handleInput(data: string): void {
    this.#child.handleInput?.(data)
  }

  invalidate(): void {
    this.#child.invalidate()
  }
}
