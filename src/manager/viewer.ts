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
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'

import { BorderView } from '../border-view.js'
import { rightAlign, strInline } from '../helper.js'
import { ScrollView } from '../scroll-view.js'
import type { LiveWorker, WorkerManager, WorkerStatus } from './worker.js'

const STATUS_COLOR = {
  running: 'accent',
  done: 'success',
  failed: 'error',
  stopped: 'dim',
} satisfies Record<WorkerStatus, ThemeColor>

/** Handle to the active worker viewer overlay so a new open can close it first. */
let openedViewerHandle: OverlayHandle | undefined

/** Result text preview length in the viewer (keeps one verbose call from drowning the rest). */
const TOOL_RESULT_PREVIEW = 500
/** Terminal-row percentage the worker overlay occupies. */
const VIEWPORT_HEIGHT_PCT = 80
/** Border, header, separators, and footer outside the scroll viewport. */
const VIEWER_CHROME_LINES = 6
/** Overlay width as a percentage of the terminal. */
const OVERLAY_WIDTH_PCT = '90%'

/** Result reported when the viewer closes: plain close, or a request to steer. */
export type ViewerResult = undefined | 'steer'

/**
 * Live, auto-following overlay of a worker's conversation
 */
export class WorkerViewer implements Component {
  #stopArmed = false
  readonly #scroll: ScrollView
  readonly #unsubscribe: () => void

  constructor(
    private tui: TUI,
    private theme: Theme,
    private worker: LiveWorker,
    private manager: WorkerManager,
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
    this.#unsubscribe = worker.session.subscribe(() => {
      tui.requestRender()
    })
  }

  handleInput(data: string): void {
    if (isKeyRelease(data)) return

    if (matchesKey(data, Key.escape) || data === 'q') {
      this.done(undefined)
      return
    }

    if (data === 'x' && this.worker.status === 'running') {
      if (this.#stopArmed) {
        this.#stopArmed = false
        void this.manager.abort(this.worker.id).then(() => {
          this.tui.requestRender()
        })
      } else {
        this.#stopArmed = true
      }
      this.tui.requestRender()
      return
    }
    if (this.#stopArmed) this.#stopArmed = false

    if (matchesKey(data, Key.enter) && this.worker.status === 'running') {
      this.done('steer')
      return
    }

    this.#scroll.handleInput(data)
  }

  render(width: number): string[] {
    if (width < 4) return []
    const separator = this.theme.fg('dim', '─'.repeat(width))
    return [
      this.headerLine(width),
      separator,
      ...this.#scroll.render(width),
      separator,
      this.footerLine(width),
    ]
  }

  invalidate(): void {
    this.#scroll.invalidate()
  }

  dispose(): void {
    this.#unsubscribe()
  }

  // ---- private ----

  private headerLine(width: number): string {
    const th = this.theme
    const status = this.worker.status
    const color = STATUS_COLOR[status]
    const id = `#${this.worker.id}`
    const titleMaxWidth = width - visibleWidth(status + id) - 1
    return rightAlign(
      `${th.fg('muted', `#${this.worker.id}`)} ${truncateToWidth(strInline(this.worker.title), titleMaxWidth)}`,
      th.fg(color, status),
      width,
    )
  }

  private footerLine(width: number): string {
    const th = this.theme
    const running = this.worker.status === 'running'
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
      ['u/d ␣', 'PageUp/Dn page'],
      ['g/G', 'Home/End jump'],
      ['q/esc', 'close'],
    )
    return truncateToWidth(
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
    const messages = this.worker.session.messages
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
            truncateToWidth(
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
    return lines.map((line) => truncateToWidth(line, width))
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

export async function openWorkerViewer(
  ctx: ExtensionContext,
  manager: WorkerManager,
  id: number,
): Promise<void> {
  const worker = manager.get(id)
  if (!worker) {
    ctx.ui.notify(`Worker #${id} not found.`, 'warning')
    return
  }
  openedViewerHandle?.hide()
  ctx.ui.setWorkingVisible(false)
  let result: ViewerResult
  try {
    result = await ctx.ui.custom<ViewerResult>(
      (tui, theme, _keybindings, done) =>
        new BorderView(theme, {
          child: new WorkerViewer(tui, theme, worker, manager, done),
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
  const message = await ctx.ui.editor(`Steer worker #${id}:`, '')
  const trimmed = message?.trim()
  if (trimmed) {
    const ok = await manager.steer(id, trimmed)
    ctx.ui.notify(
      ok ? `Steered worker #${id}.` : `Worker #${id} is no longer running.`,
      ok ? 'info' : 'warning',
    )
  }
  return openWorkerViewer(ctx, manager, id)
}
