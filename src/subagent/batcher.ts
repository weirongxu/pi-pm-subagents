import { escapeXml } from '../utils/xml.js'
import { formatSubagentSummary, type LiveSubagent } from './manager.js'

const MESSAGE_TYPES = {
  activity: { tag: 'subagent-activity', queue: 'response' },
  done: { tag: 'subagent-done', queue: 'response' },
  reviewed: { tag: 'subagent-reviewed', queue: 'response' },
  steer: { tag: 'subagent-steer', queue: 'silent' },
} as const satisfies Record<
  string,
  { tag: string; queue: 'silent' | 'response' }
>

export type SubagentMessageType = keyof typeof MESSAGE_TYPES

interface Buffer {
  silent: string[]
  response: string[]
  timer: ReturnType<typeof setTimeout> | undefined
}

export class MessageBatcher {
  private buffer: Buffer = { silent: [], response: [], timer: undefined }

  constructor(
    private readonly flush: (
      messages: readonly string[],
      triggerTurn: boolean,
    ) => void,
    private readonly windowMs = 3000,
  ) {}

  add(
    subagent: LiveSubagent,
    type: SubagentMessageType,
    message: string,
  ): void {
    const { tag, queue } = MESSAGE_TYPES[type]
    const lines = [
      `<${tag}>`,
      `<type>${type}</type>`,
      `<job>${escapeXml(formatSubagentSummary(subagent))}</job>`,
      `<message>${escapeXml(message)}</message>`,
      `</${tag}>`,
    ]
    this.buffer[queue].push(lines.join('\n'))
    this.rescheduleTimer()
  }

  flushNow(): void {
    this.clearTimer()
    const { silent, response } = this.buffer
    this.buffer.silent = []
    this.buffer.response = []
    if (silent.length) this.flush(silent, false)
    if (response.length) this.flush(response, true)
  }

  clear(): void {
    this.clearTimer()
    this.buffer.silent = []
    this.buffer.response = []
  }

  private rescheduleTimer(): void {
    this.clearTimer()
    this.buffer.timer = setTimeout(() => {
      this.flushNow()
    }, this.windowMs)
  }

  private clearTimer(): void {
    if (this.buffer.timer === undefined) return
    clearTimeout(this.buffer.timer)
    this.buffer.timer = undefined
  }
}
