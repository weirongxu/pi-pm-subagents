import { escapeXml } from '../utils/xml.js'
import { formatSubagentSummary, type LiveSubagent } from './manager.js'

const TAG_NAMES = {
  activity: 'subagent-activity',
  done: 'subagent-done',
  reviewed: 'subagent-reviewed',
} as const

export type SubagentMessageType = keyof typeof TAG_NAMES

export function formatFeedback(feedback: readonly string[]): string[] {
  const lines = ['<feedback>']
  for (const item of feedback) {
    lines.push(`<item>${escapeXml(item)}</item>`)
  }
  lines.push('</feedback>')
  return lines
}

export class MessageBatcher {
  private buffer: string[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly flush: (buffer: string[]) => void,
    private readonly windowMs = 3000,
  ) {}

  get pending(): readonly string[] {
    return [...this.buffer]
  }

  add(
    subagent: LiveSubagent,
    type: SubagentMessageType,
    message: string,
    feedback?: readonly string[],
  ): void {
    const tagName = TAG_NAMES[type]
    const lines = [
      `<${tagName}>`,
      `<type>${type}</type>`,
      `<job>${escapeXml(formatSubagentSummary(subagent))}</job>`,
    ]
    if (feedback && feedback.length > 0) {
      lines.push(...formatFeedback(feedback))
    }
    lines.push(`<message>${escapeXml(message)}</message>`)
    lines.push(`</${tagName}>`)
    const item = lines.join('\n')
    this.buffer.push(item)
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.flushNow()
    }, this.windowMs)
  }

  flushNow(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.buffer.length === 0) return

    const buffer = this.buffer
    this.buffer = []
    this.flush(buffer)
  }

  clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.buffer = []
  }
}
