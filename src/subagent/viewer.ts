import type { UserMessage } from '@earendil-works/pi-ai'
import type {
  ExtensionContext,
  Theme,
  ThemeColor,
} from '@earendil-works/pi-coding-agent'
import type { Component, OverlayHandle, TUI } from '@earendil-works/pi-tui'
import {
  isKeyRelease,
  Key,
  matchesKey,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'

import { BorderView } from '../ui/border-view.js'
import { ScrollView } from '../ui/scroll-view.js'
import { rightAlign, strInline } from '../utils/format.js'
import { truncateText } from '../utils/truncate.js'
import type {
  LiveSubagent,
  SubagentManager,
  SubagentStatus,
} from './manager.js'

const STATUS_COLOR = {
  running: 'accent',
  done: 'success',
  failed: 'error',
  killed: 'dim',
} satisfies Record<SubagentStatus, ThemeColor>

let openedViewerHandle: OverlayHandle | undefined

const TOOL_RESULT_PREVIEW = 500
const VIEWPORT_HEIGHT_PCT = 80
const VIEWER_CHROME_LINES = 7
const OVERLAY_WIDTH_PCT = '90%'

export type ViewerResult = undefined | 'steer'

export class SubagentViewer implements Component {
  #stopArmed = false
  readonly #scroll: ScrollView
  readonly #unsubscribe: () => void

  constructor(
    private tui: TUI,
    private theme: Theme,
    private subagent: LiveSubagent,
    private manager: SubagentManager,
    private done: (result: ViewerResult) => void,
  ) {
    this.#scroll = new ScrollView(tui, theme, {
      child: {
        render: (width) => this.renderContent(width),
        invalidate: () => {},
      },
      viewportHeight: () =>
        Math.max(
          3,
          Math.floor((tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100) -
            VIEWER_CHROME_LINES,
        ),
      autoFollow: true,
    })
    this.#unsubscribe = subagent.session.subscribe(() => {
      tui.requestRender()
    })
  }

  handleInput(data: string): void {
    if (isKeyRelease(data)) return

    if (matchesKey(data, Key.escape) || data === 'q') {
      this.done(undefined)
      return
    }

    if (data === 'x' && this.subagent.status === 'running') {
      if (this.#stopArmed) {
        this.#stopArmed = false
        void this.manager.abort(this.subagent.id).then(() => {
          this.tui.requestRender()
        })
      } else {
        this.#stopArmed = true
      }
      this.tui.requestRender()
      return
    }
    if (this.#stopArmed) this.#stopArmed = false

    if (matchesKey(data, Key.enter) && this.subagent.status === 'running') {
      this.done('steer')
      return
    }

    this.#scroll.handleInput(data)
  }

  render(width: number): string[] {
    if (width < 4) return []
    const separator = this.theme.fg('dim', '─'.repeat(width))
    const lines = [this.headerLine(width)]
    const tools = this.toolsLine(width)
    if (tools) lines.push(tools)
    lines.push(
      separator,
      ...this.#scroll.render(width),
      separator,
      this.footerLine(width),
    )
    return lines
  }

  invalidate(): void {
    this.#scroll.invalidate()
  }

  dispose(): void {
    this.#unsubscribe()
  }

  private headerLine(width: number): string {
    const th = this.theme
    const status = this.subagent.status
    const color = STATUS_COLOR[status]
    const id = `#${this.subagent.id}`
    const role = `[${this.subagent.role}]`
    const titleMaxWidth = width - visibleWidth(`${status + id} ${role}`) - 1
    return rightAlign(
      `${th.fg('muted', `#${this.subagent.id}`)} ${th.fg('muted', role)} ${truncateText(strInline(this.subagent.title), titleMaxWidth)}`,
      th.fg(color, status),
      width,
    )
  }

  private toolsLine(width: number): string {
    const th = this.theme
    const tools = this.subagent.activeTools
    if (tools.length === 0) return ''
    const sep = th.fg('dim', ' · ')
    return rightAlign(
      '',
      `Tools: ${tools.map((name) => th.fg('muted', name)).join(sep)}`,
      width,
    )
  }

  private footerLine(width: number): string {
    const th = this.theme
    const running = this.subagent.status === 'running'
    const sep = th.fg('dim', ' · ')
    const keys: [string, string][] = []
    if (running) {
      keys.push(this.#stopArmed ? ['x', 'again to STOP'] : ['x', 'stop'], [
        'enter',
        'steer',
      ])
    }
    keys.push(
      ['j/k ↑/↓', 'line'],
      ['u/e/d ␣', 'PgUp/Dn ½page'],
      ['g/G', 'Home/End jump'],
      ['q/esc', 'close'],
    )
    return truncateText(
      keys
        .map(
          ([key, desc]) =>
            `${th.fg('syntaxKeyword', key)} ${th.fg('success', desc)}`,
        )
        .join(sep),
      width,
    )
  }

  private renderContent(width: number): string[] {
    if (width <= 0) return []
    const th = this.theme
    const messages = this.subagent.session.messages
    if (messages.length === 0)
      return [th.fg('dim', '(waiting for first message…)')]

    const separatorLine = th.fg('dim', '─'.repeat(width))
    const lines: string[] = []
    let separator = false
    for (const message of messages) {
      if (message.role === 'user') {
        const text = userText(message)
        if (!text.trim()) continue
        if (separator) lines.push(separatorLine)
        lines.push(th.fg('accent', th.bold('[user]')))
        lines.push(...wrapTextWithAnsi(text.trim(), width))
      } else if (message.role === 'assistant') {
        const text: string[] = []
        const tools: { name: string; params: string }[] = []
        for (const block of message.content) {
          if (block.type === 'text' && block.text) text.push(block.text)
          else if (block.type === 'toolCall')
            tools.push({
              name: block.name,
              params: JSON.stringify(block.arguments),
            })
        }
        if (text.length === 0 && tools.length === 0) continue
        if (separator) lines.push(separatorLine)
        lines.push(th.bold('[assistant]'))
        if (text.length > 0)
          lines.push(...wrapTextWithAnsi(text.join('\n').trim(), width))
        for (const { name, params } of tools) {
          lines.push(
            truncateText(
              `${th.fg('muted', `🔧 ${name}`)} ${th.fg('dim', params)}`,
              width,
            ),
          )
        }
      } else if (message.role === 'toolResult') {
        const raw = message.content
          .filter(
            (block): block is { type: 'text'; text: string } =>
              block.type === 'text',
          )
          .map((block) => block.text)
          .join('\n')
          .trim()
        if (!raw) continue
        const preview =
          raw.length > TOOL_RESULT_PREVIEW
            ? `${raw.slice(0, TOOL_RESULT_PREVIEW)}…`
            : raw
        if (separator) lines.push(separatorLine)
        lines.push(th.fg('dim', '[result]'))
        lines.push(
          ...wrapTextWithAnsi(preview, width).map((line) => th.fg('dim', line)),
        )
      }
      separator = true
    }
    return lines.map((line) => truncateText(line, width))
  }
}

function userText(message: UserMessage): string {
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter(
          (block): block is { type: 'text'; text: string } =>
            block.type === 'text',
        )
        .map((block) => block.text)
        .join('\n')
}

export async function openSubagentViewer(
  ctx: ExtensionContext,
  manager: SubagentManager,
  id: number,
): Promise<void> {
  const subagent = manager.get(id)
  if (!subagent) {
    ctx.ui.notify(`Subagent #${id} not found.`, 'warning')
    return
  }
  openedViewerHandle?.hide()
  ctx.ui.setWorkingVisible(false)
  let result: ViewerResult
  try {
    result = await ctx.ui.custom<ViewerResult>(
      (tui, theme, _keybindings, done) =>
        new BorderView(theme, {
          child: new SubagentViewer(tui, theme, subagent, manager, done),
        }),
      {
        overlay: true,
        overlayOptions: {
          anchor: 'center',
          width: OVERLAY_WIDTH_PCT,
          maxHeight: `${VIEWPORT_HEIGHT_PCT}%`,
        },
        onHandle: (handle) => {
          openedViewerHandle = handle
        },
      },
    )
  } finally {
    openedViewerHandle = undefined
    ctx.ui.setWorkingVisible(true)
  }

  if (result !== 'steer') return
  const message = await ctx.ui.editor(`Steer subagent #${id}:`, '')
  const trimmed = message?.trim()
  if (trimmed) {
    const ok = await manager.steer(id, trimmed)
    ctx.ui.notify(
      ok ? `Steered subagent #${id}.` : `Subagent #${id} is no longer running.`,
      ok ? 'info' : 'warning',
    )
  }
  return openSubagentViewer(ctx, manager, id)
}
