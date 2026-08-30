import { lastMessageText } from '../utils/messages.js'
import type { LiveSubagent } from './manager.js'

const CHECK_INTERVAL_MS = 60 * 1000
const NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000
export const MAX_ACTIVITY_BYTES = 1000

export class ActivityReporter {
  private timer: ReturnType<typeof setInterval> | undefined
  private lastSentAt = new Map<number, number>()

  constructor(
    private readonly options: {
      list: () => readonly LiveSubagent[]
      onActivity: (subagent: LiveSubagent, report: string) => void
      checkIntervalMs?: number
      notificationIntervalMs?: number
    },
  ) {}

  start(): void {
    this.stop()
    const intervalMs = this.options.checkIntervalMs ?? CHECK_INTERVAL_MS
    this.timer = setInterval(() => {
      this.tick()
    }, intervalMs)
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private tick(): void {
    const now = Date.now()
    const notificationMs =
      this.options.notificationIntervalMs ?? NOTIFICATION_INTERVAL_MS
    const runningList = this.options
      .list()
      .filter((w) => w.status === 'running')
    for (const subagent of runningList) {
      const last = this.lastSentAt.get(subagent.id) ?? subagent.startedAt
      if (now - last < notificationMs) continue
      this.options.onActivity(
        subagent,
        ActivityReporter.formatActivityReport(subagent),
      )
      this.lastSentAt.set(subagent.id, now)
    }
  }

  static formatActivityReport(subagent: LiveSubagent): string {
    return (
      lastMessageText(subagent.session.messages, MAX_ACTIVITY_BYTES) ??
      '(Just started, waiting for first message)'
    )
  }
}
