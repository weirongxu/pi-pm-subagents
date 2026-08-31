import type {
  ContextUsage,
  ExtensionContext,
  Theme,
} from '@earendil-works/pi-coding-agent'
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

import { formatElapsed, rightAlign, strInline } from '../utils/format.js'
import { FOLLOW_SYMBOL } from './consts.ts'

const FLEET_KEY = 'pi-modes:fleet'
const TICK_MS = 200
const MAX_ROWS = 5

function formatTokens(count: number): string {
  if (count < 1000) return count.toString()
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  if (count < 1000000) return `${Math.round(count / 1000)}k`
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`
  return `${Math.round(count / 1000000)}M`
}

export type FleetEntryStatus = 'running' | 'done' | 'failed' | 'killed'

export interface FleetEntryBase {
  title: string
  status: FleetEntryStatus
  followUpCount: number
  startedAt: number
  completedAt?: number
  contextUsage?: ContextUsage
}

export interface FleetEntry extends FleetEntryBase {
  id: number
  previousEntries: FleetEntryBase[]
  role: string
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
      [(it) => (it.status === 'running' ? 0 : 1), (it) => it.id],
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
    const min = this.activeSelect ? 1 : 0
    this.selectedIndex = Math.max(min, Math.min(this.selectedIndex, max))
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
        this.selectedIndex = 1
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
      if (this.selectedIndex === 1) {
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
    const rosterItems = this.roster().slice(1) as {
      kind: 'item'
      item: FleetEntry
    }[]
    if (rosterItems.length === 0) return []

    const sel = this.activeSelect
      ? Math.min(this.selectedIndex, rosterItems.length)
      : -1
    const hint = this.activeSelect
      ? '↑↓ select · enter view · esc back'
      : 'esc to interrupt · ←/↓ for items'
    const mainLine = ` ${theme.fg('dim', 'subagents')}`
    const lines: string[] = [
      truncateToWidth(` ${theme.fg('dim', hint)}`, width),
      '',
      truncateToWidth(mainLine, width),
    ]

    const visible = Math.min(MAX_ROWS, rosterItems.length)
    const selItem = Math.max(0, sel - 1)
    const start = selItem < visible ? 0 : selItem - visible + 1
    const hiddenBelow = rosterItems.length - (start + visible)
    if (start > 0) {
      lines.push(rightAlign('', theme.fg('dim', `↑ ${start} more`), width))
    }
    for (let i = start; i < start + visible; i++) {
      const entry = rosterItems[i]
      if (!entry) continue
      const item = entry.item
      const isItemSelected = i + 1 === sel
      const mainPrefix = ` ${this.bullet(i + 1, sel, theme)} ${theme.fg('muted', `#${item.id} [${item.role}]`)} `
      const itemLine = this.renderItemRow(
        item,
        mainPrefix,
        width,
        isItemSelected,
        theme,
      )
      lines.push(truncateToWidth(itemLine, width))
      for (const prevEntry of item.previousEntries) {
        const prevPrefix = `    ${theme.fg('dim', '↳')} `
        const prevLine = this.renderItemRow(
          prevEntry,
          prevPrefix,
          width,
          isItemSelected,
          theme,
        )
        lines.push(truncateToWidth(prevLine, width))
      }
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
    entry: FleetEntryBase,
    prefix: string,
    width: number,
    isSelected: boolean,
    theme: Theme,
  ): string {
    const inlineTitle = strInline(entry.title)
    const processedTitle =
      entry.status !== 'running'
        ? theme.strikethrough(inlineTitle)
        : inlineTitle
    const left = prefix + processedTitle
    const statusCol = entry.status.padStart(7, ' ')
    const followCol = `${FOLLOW_SYMBOL}${entry.followUpCount}`.padStart(3, ' ')
    const elapsedCol = formatElapsed(entry).padStart(8, ' ')
    const elapsedStyled = theme.fg('muted', elapsedCol)
    const contextCol = this.renderContextCol(entry, theme)
    const right = `${theme.fg('accent', statusCol)} ${theme.fg('border', followCol)}${contextCol} ${elapsedStyled}`
    const leftMaxWidth = Math.max(0, width - visibleWidth(right) - 1)
    const line = rightAlign(truncateToWidth(left, leftMaxWidth), right, width)
    return isSelected ? theme.bg('selectedBg', line) : line
  }

  private renderContextCol(entry: FleetEntryBase, theme: Theme): string {
    const cu = entry.contextUsage
    if (!cu || cu.contextWindow === 0) return ''
    const tokens = cu.tokens
    const content =
      tokens !== null
        ? `${formatTokens(tokens)}/${formatTokens(cu.contextWindow)}`
        : '?'
    const padded = content.padStart(12, ' ')
    const percent = cu.percent
    const color =
      percent !== null && percent > 90
        ? 'error'
        : percent !== null && percent > 70
          ? 'warning'
          : 'muted'
    return theme.fg(color, padded)
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
