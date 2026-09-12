import { escapeXml } from '../utils/xml.js'
import { formatSubagentSummary, type LiveSubagent } from './manager.js'

const TAG_NAMES = {
  activity: 'subagent-activity',
  done: 'subagent-done',
} as const

export type SubagentMessageType = keyof typeof TAG_NAMES

const REVIEWED_TAG = 'subagent-reviewed'

export function formatCorrections(corrections: readonly string[]): string[] {
  const lines = ['<corrections>']
  for (const correction of corrections) {
    lines.push(`<r>${escapeXml(correction)}</r>`)
  }
  lines.push('</corrections>')
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
  ): void {
    this.push(subagent, TAG_NAMES[type], type, message)
  }

  addReviewed(
    subagent: LiveSubagent,
    message: string,
    corrections: readonly string[],
  ): void {
    this.push(subagent, REVIEWED_TAG, 'reviewed', message, corrections)
  }

  private push(
    subagent: LiveSubagent,
    tagName: string,
    typeName: SubagentMessageType | 'reviewed',
    message: string,
    corrections?: readonly string[],
  ): void {
    const lines = [
      `<${tagName}>`,
      `<type>${typeName}</type>`,
      `<job>${escapeXml(formatSubagentSummary(subagent))}</job>`,
    ]
    if (corrections && corrections.length > 0) {
      lines.push(...formatCorrections(corrections))
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
