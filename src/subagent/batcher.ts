import { type Static, Type } from 'typebox'
import { BLOCK_SEPARATOR } from '../utils/messages.js'
import type { LiveSubagent } from './manager.js'
import { formatSubagentSummary } from './manager.js'
import { mapGroupBy } from '../utils/collection.js'

const MESSAGE_TYPES = {
  activity: { queue: 'response' },
  done: { queue: 'response' },
  reviewed: { queue: 'response' },
  steer: { queue: 'silent' },
} as const satisfies Record<string, { queue: 'silent' | 'response' }>

export const SubagentMessageTypeSchema = Type.Union([
  Type.Literal('activity'),
  Type.Literal('done'),
  Type.Literal('reviewed'),
  Type.Literal('steer'),
])

export type SubagentMessageType = Static<typeof SubagentMessageTypeSchema>

/** One structured subagent notification item queued by MessageBatcher. */
export interface SubagentNotification {
  kind: SubagentMessageType
  /** formatSubagentSummary(subagent) output, e.g. "done #3 implement auth 12% ctx 5m" */
  job: string
  /** Raw subagent message text, unmodified. */
  message: string
}

/** Grouped, rendered batch handed to the flush callback per queue. */
export interface SubagentBatchMessage {
  kind: SubagentMessageType
  content: string
  jobs: string[]
}

function formatNotificationBlock(item: SubagentNotification): string {
  const [status, id, ...rest] = item.job.split(' ')
  const marker =
    status && id ? `**[${status} ${id}]**` : `**[${item.job.trim()}]**`
  const summary = rest.join(' ')
  const heading = summary ? `${marker} ${summary}` : marker
  return item.message ? `${heading}\n\n${item.message}` : heading
}

interface Buffer {
  silent: SubagentNotification[]
  response: SubagentNotification[]
  timer: ReturnType<typeof setTimeout> | undefined
}

export class MessageBatcher {
  private buffer: Buffer = { silent: [], response: [], timer: undefined }

  constructor(
    private readonly flush: (
      message: SubagentBatchMessage,
      triggerTurn: boolean,
    ) => void,
    private readonly windowMs = 3000,
  ) {}

  add(
    subagent: LiveSubagent,
    type: SubagentMessageType,
    message: string,
  ): void {
    const { queue } = MESSAGE_TYPES[type]
    this.buffer[queue].push({
      kind: type,
      job: formatSubagentSummary(subagent),
      message,
    })
    this.rescheduleTimer()
  }

  flushNow(): void {
    this.clearTimer()
    const { silent, response } = this.buffer
    this.buffer.silent = []
    this.buffer.response = []
    this.flushByKind(silent, false)
    this.flushByKind(response, true)
  }

  private flushByKind(
    items: SubagentNotification[],
    triggerTurn: boolean,
  ): void {
    if (!items.length) return
    const groups = mapGroupBy(items, (item) => item.kind)
    for (const [kind, group] of groups) {
      this.flush(
        {
          kind,
          content: group.map(formatNotificationBlock).join(BLOCK_SEPARATOR),
          jobs: group.map((item) => item.job),
        },
        triggerTurn,
      )
    }
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
