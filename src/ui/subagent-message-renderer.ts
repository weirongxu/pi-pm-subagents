import {
  BLOCK_SEPARATOR,
  MESSAGE_KEY,
  type SubagentMessageDetails,
  SubagentMessageDetailsSchema,
} from '../utils/messages.js'
import {
  Box,
  type Component,
  Container,
  Markdown,
  MouseRegion,
  type MouseRegionHandler,
  Text,
} from '@earendil-works/pi-tui'
import {
  type ExtensionAPI,
  type MessageRenderer,
  type Theme,
  getMarkdownTheme,
} from '@earendil-works/pi-coding-agent'
import { Parse } from 'typebox/value'
import { truncateText } from '../utils/truncate.js'

const COLLAPSED_PREVIEW_LINES = 3

const GENERIC_TITLE = '[pm-subagents]'

export type RendererMessage = Parameters<MessageRenderer>[0]

/** Parse message.details with the details schema; undefined when missing/invalid. */
function readDetails(
  message: RendererMessage,
): SubagentMessageDetails | undefined {
  try {
    return Parse(SubagentMessageDetailsSchema, message.details)
  } catch {
    return undefined
  }
}

const TITLE_STYLE = {
  activity: { icon: '↳', fallback: 'activity', suffix: ' · activity' },
  steer: { icon: '↳', fallback: 'steer', suffix: '' },
  done: { icon: '✓', fallback: 'done', suffix: '' },
  reviewed: { icon: '✓', fallback: 'done', suffix: ' · reviewed' },
} as const

/** Collapsed title from structured details; multi-job batches append "(+N)". */
function formatDetailsTitle(details: SubagentMessageDetails): string {
  const { icon, fallback, suffix } = TITLE_STYLE[details.kind]
  const [head] = details.jobs
  const label = head || fallback
  const extra =
    head && details.jobs.length > 1 ? ` (+${details.jobs.length - 1})` : ''
  return `${icon} ${label}${extra}${suffix}`
}

/** First block of merged content (before the block separator), for previews. */
function firstBlock(content: string): string {
  const index = content.indexOf(BLOCK_SEPARATOR)
  return index === -1 ? content : content.slice(0, index)
}

class SubagentMessageComponent extends Container {
  #content: string
  #details: SubagentMessageDetails | undefined
  #expanded: boolean
  #outputPad: number
  #theme: Theme
  #width = 0

  constructor({
    content,
    details,
    expanded,
    outputPad,
    theme,
  }: {
    content: string
    details?: SubagentMessageDetails
    expanded: boolean
    outputPad: number
    theme: Theme
  }) {
    super()
    this.#content = content
    this.#details = details
    this.#expanded = expanded
    this.#outputPad = outputPad
    this.#theme = theme
    this.rebuild()
  }

  setExpanded(expanded: boolean): void {
    if (this.#expanded === expanded) return
    this.#expanded = expanded
    this.rebuild()
  }

  override render(width: number): string[] {
    if (width !== this.#width) {
      this.#width = width
      this.rebuild()
    }
    return super.render(width)
  }

  invalidate(): void {
    super.invalidate()
    this.rebuild()
  }

  rebuild(): void {
    this.clear()
    const child = this.renderChild()
    const onMouse: MouseRegionHandler = (event) => {
      if (event.type !== 'click' || event.button !== 'left') return undefined
      this.setExpanded(!this.#expanded)
      return { handled: true }
    }
    this.addChild(new MouseRegion(child, onMouse))
  }

  private renderChild(): Component {
    if (!this.#expanded) {
      return renderCollapsed(
        this.#content,
        this.#details,
        this.#width,
        this.#outputPad,
        this.#theme,
      )
    }
    const box = new Box(1 + this.#outputPad, 1, (text) =>
      this.#theme.bg('customMessageBg', text),
    )
    box.addChild(
      new Text(
        this.#theme.fg('customMessageLabel', this.#theme.bold(GENERIC_TITLE)),
        0,
        0,
      ),
    )
    const cleaned = this.#content.trim()
    if (cleaned) {
      box.addChild(
        new Markdown(cleaned, 0, 0, getMarkdownTheme(), {
          color: (text) => this.#theme.fg('customMessageText', text),
        }),
      )
    }
    return box
  }
}

export function setupMessageRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(
    MESSAGE_KEY,
    (message, options, theme): Component | undefined => {
      if (!message.display) return undefined
      const rawContent =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((block) => block.type === 'text')
              .map((block) => block.text)
              .join('\n')
      const details = readDetails(message)

      return new SubagentMessageComponent({
        content: rawContent,
        details,
        expanded: options.expanded,
        outputPad: options.outputPad,
        theme,
      })
    },
  )
}

function renderCollapsed(
  content: string,
  details: SubagentMessageDetails | undefined,
  width: number,
  outputPad: number,
  theme: Theme,
): Component {
  const title = details ? formatDetailsTitle(details) : GENERIC_TITLE
  const previewWidth = Math.max(0, width - outputPad * 2)
  const lines = [
    theme.fg('customMessageLabel', theme.bold(title)),
    ...previewLines(content).map((line) =>
      theme.fg('dim', truncateText(line, previewWidth)),
    ),
  ]
  return new Text(lines.join('\n'), outputPad, 0)
}

function previewLines(content: string): string[] {
  return firstBlock(content)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, COLLAPSED_PREVIEW_LINES)
}
