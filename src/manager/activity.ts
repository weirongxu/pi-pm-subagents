import { lastMessageText } from '../helper.js'
import type { LiveWorker } from './worker.js'

const CHECK_INTERVAL_MS = 60 * 1000
const NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000
const MAX_ACTIVITY_BYTES = 500

export class ActivityReporter {
  private timer: ReturnType<typeof setInterval> | undefined
  private lastSentAt = new Map<number, number>()

  constructor(
    private readonly options: {
      list: () => readonly LiveWorker[]
      onActivity: (worker: LiveWorker, report: string) => void
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
    const running = this.options.list().filter((w) => w.status === 'running')
    for (const worker of running) {
      const last = this.lastSentAt.get(worker.id) ?? worker.startedAt
      if (now - last < notificationMs) continue
      this.options.onActivity(
        worker,
        ActivityReporter.formatActivityReport(worker),
      )
      this.lastSentAt.set(worker.id, now)
    }
  }

  static formatActivityReport(worker: LiveWorker): string {
    return (
      lastMessageText(worker.session.messages, MAX_ACTIVITY_BYTES) ??
      '(Just started, waiting for first message)'
    )
  }
}
