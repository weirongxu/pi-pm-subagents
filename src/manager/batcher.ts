import { formatWorkerSummary, type LiveWorker } from './worker.ts'

export class MessageBatcher {
  private items: string[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly flush: (items: string[]) => void,
    private readonly windowMs = 5000,
  ) {}

  get pending(): readonly string[] {
    return [...this.items]
  }

  add(worker: LiveWorker, type: string, message: string): void {
    const item = [
      formatWorkerSummary(worker),
      `<notify-type>${type}</notify-type>`,
      `<message>\n${message}\n</message>`,
    ].join('\n')
    this.items.push(item)
    if (this.timer !== undefined) return
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
