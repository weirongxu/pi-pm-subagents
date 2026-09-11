import { escapeXml } from '../utils/xml.js'
import { formatSubagentSummary, type LiveSubagent } from './manager.js'

const TAG_NAMES = {
  activity: 'subagent-activity',
  done: 'subagent-done',
  reviewed: 'subagent-reviewed',
} as const

export type SubagentMessageType = keyof typeof TAG_NAMES

export class MessageBatcher {
  private items: string[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly flush: (items: string[]) => void,
    private readonly windowMs = 3000,
  ) {}

  get pending(): readonly string[] {
    return [...this.items]
  }

  add(
    subagent: LiveSubagent,
    type: SubagentMessageType,
    message: string,
  ): void {
    const tagName = TAG_NAMES[type]
    const lines = [
      `<${tagName}>`,
      `<type>${type}</type>`,
      `<job>${escapeXml(formatSubagentSummary(subagent))}</job>`,
      `<message>${escapeXml(message)}</message>`,
      `</${tagName}>`,
    ]
    const item = lines.join('\n')
    this.items.push(item)
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
    if (this.items.length === 0) return

    const items = this.items
    this.items = []
    this.flush(items)
  }

  clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.items = []
  }
}
