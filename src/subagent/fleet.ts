import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { Editor } from '@earendil-works/pi-tui'
import {
  isKeyRelease,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui'
import { orderBy } from 'lodash-es'

import { formatElapsed, rightAlign, strInline } from '../helper.js'

const FLEET_KEY = 'pi-modes:fleet'
const TICK_MS = 200
const MAX_ROWS = 5

export type FleetEntryStatus = 'running' | 'done' | 'failed' | 'killed'

export interface FleetEntry {
  id: number
  title: string
  status: FleetEntryStatus
  startedAt: number
  completedAt?: number
  followUpCount: number
}

export interface FleetListOptions {
  list: () => FleetEntry[]
  onOpen: (ctx: ExtensionContext, id: number) => void | Promise<void>
}

type RosterEntry = { kind: 'main' } | { kind: 'item'; item: FleetEntry }

export class FleetList {
  private ctx: ExtensionContext | undefined
  private tui: TUI | undefined
  private inputUnsub: (() => void) | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private registered = false
  private activeSelect = false
  private selectedIndex = 0

  constructor(private options: FleetListOptions) {}

  setContext(ctx: ExtensionContext): void {
    if (ctx === this.ctx) return
    this.inputUnsub?.()
    this.ctx = ctx
    this.registered = false
    this.tui = undefined
    this.inputUnsub = ctx.ui.onTerminalInput((data) => this.handleKey(data))
    this.update()
  }

  update(): void {
    const ctx = this.ctx
    if (!ctx) return

    const items = this.options.list()
    if (items.length === 0) {
      this.hide()
      return
    }

    this.clampSelection()
    this.ensureTimer()

    if (!this.registered) {
      ctx.ui.setWidget(
        FLEET_KEY,
        (tui) => {
          this.tui = tui
          return {
            render: (width: number) => this.renderBar(width),
            invalidate: () => {
              this.registered = false
              this.tui = undefined
            },
          }
        },
        { placement: 'belowEditor' },
      )
      this.registered = true
    } else {
      this.tui?.requestRender()
    }
  }

  hide() {
    const ctx = this.ctx
    if (!ctx) return
    if (this.registered) {
      ctx.ui.setWidget(FLEET_KEY, undefined)
      this.registered = false
      this.tui = undefined
    }
    this.stopTimer()
    this.activeSelect = false
    this.selectedIndex = 0
  }

  private editorHasFocus(): boolean {
    if (!this.tui) return true
    const focused = (this.tui as unknown as { focusedComponent?: unknown })
      .focusedComponent
    if (focused == null) return true
    return focused instanceof Editor
  }

  dispose(): void {
    this.stopTimer()
    this.inputUnsub?.()
    this.inputUnsub = undefined
    this.hide()
    this.ctx = undefined
    this.activeSelect = false
    this.selectedIndex = 0
  }

  private roster(): RosterEntry[] {
    const items = orderBy(
      this.options.list(),
      (it) => [it.status === 'running' ? 0 : 1, it.id],
      ['asc', 'desc'],
    )
    return [
      { kind: 'main' },
      ...items.map((item): RosterEntry => ({
        kind: 'item',
        item,
      })),
    ]
  }

  private clampSelection(): void {
    const max = this.roster().length - 1
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, max))
  }

  private handleKey(data: string): { consume?: boolean } | undefined {
    const ctx = this.ctx
    if (!ctx) return undefined
    if (isKeyRelease(data)) return undefined
    if (this.tui?.hasOverlay()) return
    if (!this.editorHasFocus()) {
      if (this.activeSelect) {
        this.deactivate()
      }
      return undefined
    }

    if (!this.activeSelect) {
      const activator = matchesKey(data, 'down') || matchesKey(data, 'left')
      if (
        activator &&
        this.options.list().length > 0 &&
        ctx.ui.getEditorText() === ''
      ) {
        this.activeSelect = true
        this.selectedIndex = 0
        this.update()
        return { consume: true }
      }
      return undefined
    }

    if (matchesKey(data, 'down')) {
      const max = this.roster().length - 1
      this.selectedIndex = Math.min(max, this.selectedIndex + 1)
      this.update()
      return { consume: true }
    }
    if (matchesKey(data, 'up')) {
      if (this.selectedIndex === 0) {
        this.deactivate()
        return { consume: true }
      }
      this.selectedIndex -= 1
      this.update()
      return { consume: true }
    }
    if (matchesKey(data, Key.escape)) {
      this.deactivate()
      return { consume: true }
    }
    if (matchesKey(data, Key.enter)) {
      void this.openSelected()
      return { consume: true }
    }

    this.deactivate()
    return undefined
  }

  private deactivate(): void {
    this.activeSelect = false
    this.selectedIndex = 0
    this.update()
  }

  private async openSelected(): Promise<void> {
    const ctx = this.ctx
    if (!ctx) return
    const entry = this.roster()[this.selectedIndex]
    if (!entry || entry.kind === 'main') {
      this.deactivate()
      return
    }
    const id = entry.item.id
    await this.options.onOpen(ctx, id)
    this.update()
  }

  private renderBar(width: number): string[] {
    const ctx = this.ctx
    if (!ctx) return []
    const theme = ctx.ui.theme
    const items = this.roster().slice(1) as {
      kind: 'item'
      item: FleetEntry
    }[]
    if (items.length === 0) return []

    const sel = Math.min(this.selectedIndex, items.length)
    const hint = this.activeSelect
      ? '↑↓ select · enter view · esc back'
      : 'esc to interrupt · ←/↓ for items'
    const lines: string[] = [
      truncateToWidth(` ${theme.fg('dim', hint)}`, width),
      '',
      truncateToWidth(` ${this.bullet(0, sel, theme)} main`, width),
    ]

    const visible = Math.min(MAX_ROWS, items.length)
    const selItem = Math.max(0, sel - 1)
    const start = selItem < visible ? 0 : selItem - visible + 1
    const hiddenBelow = items.length - (start + visible)
    if (start > 0) {
      lines.push(rightAlign('', theme.fg('dim', `↑ ${start} more`), width))
    }
    for (let i = start; i < start + visible; i++) {
      const entry = items[i]
      if (!entry) continue
      lines.push(this.renderItemRow(i + 1, sel, entry.item, width, theme))
    }
    if (hiddenBelow > 0) {
      lines.push(
        rightAlign('', theme.fg('dim', `↓ ${hiddenBelow} more`), width),
      )
    }
    return lines
  }

  private bullet(index: number, sel: number, theme: Theme): string {
    return index === sel ? theme.fg('accent', '●') : theme.fg('dim', '◯')
  }

  private renderItemRow(
    index: number,
    sel: number,
    item: FleetEntry,
    width: number,
    theme: Theme,
  ): string {
    const isRunning = item.status === 'running'
    let title = strInline(item.title)
    if (!isRunning) title = theme.strikethrough(title)
    const left = ` ${this.bullet(index, sel, theme)} ${theme.fg('muted', `#${item.id}`)} ${title}`
    const followUpPart = theme.fg('dim', `F(${item.followUpCount})`)
    const right = `${theme.fg('accent', item.status)} ${followUpPart} ${theme.fg('dim', formatElapsed(item))}`
    const leftMaxWidth = Math.max(0, width - visibleWidth(right) - 1)
    return rightAlign(truncateToWidth(left, leftMaxWidth), right, width)
  }

  private ensureTimer(): void {
    if (!this.timer) {
      this.timer = setInterval(() => this.tui?.requestRender(), TICK_MS)
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
}
